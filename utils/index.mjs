import gm from "gm";
import sharp from "sharp";
import spawn from "cross-spawn";
import path from "path";
import { fileURLToPath } from "url";
import net from "net";
import { URL } from "url";
import config from "../config/index.mjs";
import { exec, spawn as nodeSpawn } from "child_process";

/**
 * Checks if the llama-server port is listening.
 * @returns {Promise<boolean>} True if the server is likely running, false otherwise.
 */
export async function isLlamaServerRunning() {
  return new Promise((resolve) => {
    let serverUrl;
    let hostname;
    let port;
    try {
      serverUrl = new URL(config.LLAMA_SERVER_URL);
      hostname = serverUrl.hostname;
      port = parseInt(serverUrl.port, 10);
      if (isNaN(port)) throw new Error("Invalid port");
    } catch (e) {
      console.error(
        `[HealthCheck] Invalid LLAMA_SERVER_URL: ${config.LLAMA_SERVER_URL}`,
        e
      );
      return resolve(false); // Cannot check if URL is invalid
    }

    const socket = new net.Socket();
    let connectionRefused = false;

    socket.setTimeout(1000); // 1 second timeout for connection attempt

    socket.on("connect", () => {
      console.log(
        `[HealthCheck] Connection successful to ${hostname}:${port}. Server is running.`
      );
      socket.destroy(); // Close the socket immediately
      resolve(true);
    });

    socket.on("timeout", () => {
      console.warn(
        `[HealthCheck] Connection timeout to ${hostname}:${port}. Assuming server is down or slow.`
      );
      socket.destroy();
      resolve(false);
    });

    socket.on("error", (err) => {
      // Check if the error is "connection refused"
      if (err.code === "ECONNREFUSED") {
        connectionRefused = true;
        console.log(
          `[HealthCheck] Connection refused on ${hostname}:${port}. Server is not running.`
        );
      } else {
        // Log other errors but might still resolve false
        console.warn(
          `[HealthCheck] Error connecting to ${hostname}:${port}: ${
            err.code || err.message
          }`
        );
      }
      socket.destroy(); // Ensure socket is destroyed on error
      resolve(false); // Resolve false on any error
    });

    // Close event is guaranteed to be called after error or timeout
    socket.on("close", () => {
      // If the socket closed without connecting and it wasn't ECONNREFUSED,
      // it might indicate another issue, but we still assume server is down for simplicity.
      // The 'error' or 'timeout' handler already called resolve(false).
      // If it connected, 'connect' already called resolve(true).
      // console.log(`[HealthCheck] Socket closed for ${hostname}:${port}. Refused: ${connectionRefused}`);
    });

    console.log(
      `[HealthCheck] Attempting connection to ${hostname}:${port}...`
    );
    socket.connect(port, hostname);
  });
}

/**
 * Starts the chat.py script as a detached background process.
 */
export function startLlamaServer() {
  console.log("[AutoStart] Attempting to start llama-server via chat.py...");
  const cmd = config.PYTHON_EXECUTABLE;
  const args = [config.CHAT_SCRIPT_PATH]; // Add default args from chat.py if needed

  try {
    const child = spawn(cmd, args, {
      detached: true, // Allow parent (Node) to exit independently
      stdio: "ignore", // Prevent child stdio from blocking/interfering
      // cwd: path.dirname(config.CHAT_SCRIPT_PATH) // Optional: set working directory if script needs it
    });

    // Allow the Node.js process to exit even if the child is still running
    child.unref();

    console.log(
      `[AutoStart] Launched chat.py process (PID maybe available: ${
        child.pid || "N/A"
      }). Node will not wait for it.`
    );
    // Note: We don't know for sure if llama-server started successfully yet.
    // The next health check before fetch will verify.
    return true; // Indicate launch attempt was made
  } catch (error) {
    console.error("[AutoStart] Failed to spawn chat.py:", error);
    return false; // Indicate launch attempt failed
  }
}

// --- Function to run kill script OR perform graceful kill ---
/**
 * Kills llama-server processes.
 * @param {boolean} force - If true, runs kill_llama.sh --force (SIGKILL).
 *                        If false, attempts graceful kill (SIGTERM, wait, SIGKILL) directly in Node.
 * @returns {Promise<{message: string, killedPids: number[], stderr?: string}>} Resolves with outcome.
 * @throws {Error} Rejects if finding/killing processes fails.
 */
export async function runKillLlamaScript(force = false) {
  const PROCESS_NAME = "llama-server"; // Match the script's target

  if (force) {
    // --- Force Kill via Shell Script ---
    return new Promise((resolve, reject) => {
      const projectRoot = path.dirname(
        path.dirname(fileURLToPath(import.meta.url))
      );
      const scriptPath = path.join(projectRoot, "kill_llama.sh");
      const args = ["--force"];

      console.log(
        `Executing force kill script: ${scriptPath} ${args.join(" ")}`
      );
      const child = spawn(scriptPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      // [ Keep the existing spawn logic for handling stdout, stderr, error, exit events from the script ]
      // ... (stdout/stderr collection, error handling, exit code check) ...
      let stdout = "";
      let stderr = "";
      let exited = false;
      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data) => {
        const line = data.toString().trim();
        if (line) {
          stderr += line + "\n";
          console.error(`stderr [kill_llama.sh]: ${line}`);
        }
      });
      const handleError = (error, code = 1) => {
        if (exited) return;
        exited = true;
        const errMsg = error?.message || "Kill script execution failed";
        console.error(`Error executing kill_llama.sh: ${errMsg}`, error);
        const errObj = new Error(
          `Kill script failed (code ${code}): ${errMsg}`
        );
        errObj.stdout = stdout;
        errObj.stderr = stderr;
        errObj.script = scriptPath;
        reject(errObj);
      };
      child.on("error", (error) => {
        if (error.code === "ENOENT") {
          handleError(
            new Error(`Script not found at ${scriptPath}. Check path.`)
          );
        } else if (error.code === "EACCES") {
          handleError(
            new Error(
              `Permission denied executing ${scriptPath}. Ensure it has execute permissions (chmod +x).`
            )
          );
        } else {
          handleError(error);
        }
      });
      child.on("exit", (code, signal) => {
        if (exited) return;
        exited = true;
        console.log(`kill_llama.sh exited with code ${code}, signal ${signal}`);
        if (code !== 0) {
          handleError(new Error(`Exited with code ${code}`), code);
        } else {
          resolve({
            message: "Force kill script executed.",
            killedPids: [],
            stdout: stdout,
            stderr: stderr,
          });
        }
      }); // killedPids not easily available from script output here
      child.on("close", (code) =>
        console.log(`--> Stdio closed for kill_llama.sh (code ${code})`)
      );
    });
  } else {
    // --- Graceful Kill Logic in Node.js ---
    console.log(`Attempting graceful kill for '${PROCESS_NAME}' processes...`);
    return new Promise((resolve, reject) => {
      // 1. Find PIDs using pgrep (requires pgrep to be installed)
      //    Filter out node, pgrep, and this script itself. Match full command line (-f).
      //    This command is potentially fragile if process names change.
      const pgrepCommand = `pgrep -af '${PROCESS_NAME}' | grep -v ' node ' | grep -v ' pgrep ' | awk '{print $1}'`;
      exec(pgrepCommand, async (error, stdout, stderr) => {
        if (error && !stdout) {
          // Error only if stdout is also empty (pgrep returns 1 if no match)
          console.warn(
            `pgrep failed or no processes found. Stderr: ${stderr}. Error: ${error.message}`
          );
          return resolve({
            message: `No running '${PROCESS_NAME}' processes found to kill gracefully.`,
            killedPids: [],
          });
        }
        if (stderr) {
          console.warn(`pgrep stderr during graceful kill: ${stderr}`);
        }

        const pids = stdout
          .trim()
          .split("\n")
          .filter((pid) => pid); // Get non-empty PIDs

        if (pids.length === 0) {
          return resolve({
            message: `No running '${PROCESS_NAME}' processes found to kill gracefully.`,
            killedPids: [],
          });
        }

        console.log(`Found PIDs for graceful termination: ${pids.join(", ")}`);
        const killedPids = [];
        let killErrors = [];

        // 2. Attempt SIGTERM, wait, then SIGKILL
        for (const pidStr of pids) {
          const pid = parseInt(pidStr, 10);
          if (isNaN(pid)) continue;

          try {
            console.log(`  - Sending SIGTERM to PID: ${pid}`);
            process.kill(pid, "SIGTERM");
          } catch (e) {
            // Ignore error if process already exited ('ESRCH')
            if (e.code !== "ESRCH") {
              console.warn(`    Error sending SIGTERM to ${pid}: ${e.message}`);
              killErrors.push(`SIGTERM ${pid}: ${e.message}`);
            } else {
              console.log(`    Process ${pid} already gone before SIGTERM.`);
            }
            continue; // Skip wait/SIGKILL if SIGTERM failed non-ESRCH
          }

          // Wait briefly
          await new Promise((res) => setTimeout(res, 2000)); // 2 seconds

          // Check if still running
          try {
            process.kill(pid, 0); // Check existence without killing
            // If no error, process still exists
            console.log(`    Process ${pid} still running, sending SIGKILL...`);
            try {
              process.kill(pid, "SIGKILL");
              killedPids.push(pid); // Assume killed
              await new Promise((res) => setTimeout(res, 100)); // Tiny pause
              try {
                process.kill(pid, 0);
                console.warn(
                  `    Warning: Process ${pid} might still exist after SIGKILL.`
                );
              } catch (e) {
                if (e.code === "ESRCH")
                  console.log(`    Process ${pid} confirmed killed.`);
                else throw e;
              }
            } catch (e) {
              if (e.code !== "ESRCH") {
                console.warn(
                  `    Error sending SIGKILL to ${pid}: ${e.message}`
                );
                killErrors.push(`SIGKILL ${pid}: ${e.message}`);
              } else {
                console.log(`    Process ${pid} gone before SIGKILL.`);
                // Technically terminated gracefully, but maybe count it?
                if (!killedPids.includes(pid)) killedPids.push(pid);
              }
            }
          } catch (e) {
            // If error is ESRCH, process terminated gracefully after SIGTERM
            if (e.code === "ESRCH") {
              console.log(`    Process ${pid} terminated gracefully.`);
              if (!killedPids.includes(pid)) killedPids.push(pid);
            } else {
              console.warn(
                `    Error checking process ${pid} after SIGTERM: ${e.message}`
              );
              killErrors.push(`Check ${pid}: ${e.message}`);
            }
          }
        } // end for loop

        // 3. Resolve with results
        const message = `Graceful kill attempt finished. ${killedPids.length}/${
          pids.length
        } processes confirmed terminated.${
          killErrors.length > 0
            ? " Encountered errors: " + killErrors.join("; ")
            : ""
        }`;
        resolve({ message: message, killedPids: killedPids });
      });
    });
  }
}

// --- PDF/Image Helpers (Unchanged logic, just moved) ---
// Note: gm relies on GraphicsMagick/ImageMagick + Ghostscript being installed
export async function convertPdfToImage(pdfPath, targetWidth) {
  console.log(`Converting PDF: ${pdfPath}`);
  return new Promise((resolve, reject) => {
    gm(pdfPath + "[0]") // Process only the first page
      .density(300, 300) // Increase density for better quality before resize
      .quality(90)
      .setFormat("png")
      .toBuffer((err, buffer) => {
        if (err) {
          console.error("gm failed:", err);
          let errMsg = `PDF conversion failed: ${err.message}`;
          if (err.message.toLowerCase().includes("delegate"))
            errMsg += " - Ghostscript installed?";
          if (err.message.toLowerCase().includes("unable to open file"))
            errMsg += ` - Check path/perms: ${pdfPath}`;
          return reject(new Error(errMsg));
        }
        console.log("gm success, buffer obtained.");
        resolve(buffer);
      });
  });
}

export async function optimizeAndSaveImage(
  imageBuffer,
  outputPathBase,
  targetWidth,
  outputFormat = "png" // Default to PNG
) {
  console.log(`Optimizing image to target width: ${targetWidth}px`);
  let sharpInstance = sharp(imageBuffer);
  const meta = await sharpInstance.metadata();

  if (meta.width && meta.width > targetWidth) {
    console.log(`Resizing from ${meta.width}px width.`);
    sharpInstance = sharpInstance.resize({ width: targetWidth });
  } else {
    console.log(
      `Width ${meta.width || "unknown"}px <= target. No resize needed.`
    );
  }

  const outputExt = outputFormat === "jpeg" ? "jpg" : "png";
  const outputPath = `${outputPathBase}.${outputExt}`;

  if (outputFormat === "jpeg") {
    await sharpInstance.jpeg({ quality: 80 }).toFile(outputPath);
  } else {
    // Ensure PNG format, apply compression
    await sharpInstance
      .png({ compressionLevel: 9, quality: 90 })
      .toFile(outputPath);
  }
  console.log(`Saved optimized image: ${outputPath}`);
  return outputPath;
}

// --- JSON Helper (Unchanged logic, just moved) ---
export function extractJsonFromString(data) {
  if (!data || typeof data !== "string") {
    console.error("extract: Invalid input data type");
    return null;
  }
  const trimmed = data.trim();
  const start = trimmed.search(/[[{]/); // Find first '[' or '{'
  if (start === -1) {
    console.error("extract: No JSON start character found.");
    return null;
  }
  const startChar = trimmed[start];
  const endChar = startChar === "{" ? "}" : "]";

  // Find the matching end bracket/brace, considering nesting
  let balance = 0;
  let end = -1;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === startChar) {
      balance++;
    } else if (trimmed[i] === endChar) {
      balance--;
    }
    if (balance === 0) {
      end = i;
      break;
    }
  }

  if (end === -1) {
    console.error("extract: No matching JSON end character found.");
    return null;
  }

  const jsonStr = trimmed.substring(start, end + 1);
  try {
    // Validate by parsing
    JSON.parse(jsonStr);
    // console.log("extract: Valid JSON extracted."); // Less verbose
    return jsonStr; // Return the valid JSON string
  } catch (e) {
    console.error(
      `extract: JSON Parse error: ${e.message}`,
      `Attempted string: ${jsonStr.substring(0, 100)}...`
    );
    return null;
  }
}

// --- Script Runner (MODIFIED for Python) ---
export function runOcrScript(scriptPath, overrides = {}) {
  return new Promise((resolve, reject) => {
    const scriptName = path.basename(scriptPath);
    console.log(
      `Executing Python script: ${scriptName} with overrides:`,
      overrides
    );

    const overrideArgs = [];
    // Convert JS camelCase/specific keys to Python argparse flags
    for (const key in overrides) {
      let flag;
      switch (key) {
        case "ngl":
          flag = "--ngl";
          break;
        case "threads":
          flag = "--threads";
          break;
        case "ctx":
          flag = "-c";
          break; // Maps to context_size in argparse
        case "nPredict":
          flag = "-n";
          break; // Maps to n_predict in argparse
        case "temp":
          flag = "--temp";
          break;
        case "ctk":
          flag = "-ctk";
          break; // Maps to cache_type_k
        case "ctv":
          flag = "-ctv";
          break; // Maps to cache_type_v
        // Add mappings for model, mmproj, image if you allow overriding them
        // case "model": flag = "--model"; break;
        // case "mmproj": flag = "--mmproj"; break;
        // case "image": flag = "--image"; break;
        default:
          // Basic kebab-case conversion attempt for unknown args
          const kebabKey = key.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`);
          flag = `--${kebabKey}`;
          console.warn(
            `[runOcrScript] Unknown override key '${key}', attempting flag '${flag}'`
          );
      }
      overrideArgs.push(flag, String(overrides[key]));
    }

    const cmd = config.PYTHON_EXECUTABLE;
    const args = [scriptPath, ...overrideArgs];

    console.log(`Running command: ${cmd} ${args.join(" ")}`);

    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }); // ignore stdin, pipe stdout/stderr

    let stdout = "";
    let stderr = "";
    let exited = false; // Flag to prevent duplicate rejection/resolution

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      const line = data.toString().trim();
      if (line) {
        // Avoid empty lines
        stderr += line + "\n";
        console.error(`stderr [${scriptName}]: ${line}`); // Log stderr lines immediately
      }
    });

    const handleError = (error, code = 1) => {
      if (exited) return;
      exited = true;
      const errMsg = error?.message || "Script execution failed";
      console.error(`Error executing script ${scriptName}: ${errMsg}`, error);
      const errObj = new Error(
        `Script ${scriptName} failed (code ${code}): ${errMsg}`
      );
      // Attach std streams to the error object for inspection in the route
      errObj.stdout = stdout;
      errObj.stderr = stderr;
      reject(errObj);
    };

    child.on("error", (error) => {
      handleError(error);
    });

    child.on("exit", (code, signal) => {
      if (exited) return; // Already handled by 'error' event possibly
      exited = true;
      console.log(
        `Script ${scriptName} exited with code ${code}, signal ${signal}`
      );
      if (code !== 0) {
        // Reject with an error object containing streams
        handleError(new Error(`Exited with code ${code}`), code);
      } else {
        // Try extracting JSON from stdout
        const jsonResult = extractJsonFromString(stdout);
        if (jsonResult) {
          console.log(`Successfully extracted JSON from ${scriptName}`);
          resolve(jsonResult); // Resolve with the JSON string
        } else {
          // Reject even on exit code 0 if JSON is expected but not found
          console.error(`No valid JSON found in stdout from ${scriptName}`);
          const errObj = new Error(`No valid JSON output from ${scriptName}`);
          errObj.stdout = stdout;
          errObj.stderr = stderr;
          reject(errObj);
        }
      }
    });
    child.on("close", (code) =>
      console.log(`--> Stdio closed for ${scriptName} (code ${code})`)
    );
  });
}

// Export all helpers
export default {
  convertPdfToImage,
  optimizeAndSaveImage,
  extractJsonFromString,
  runOcrScript,
  isLlamaServerRunning,
  startLlamaServer,
  runKillLlamaScript,
};

// NodeCanvasFactory class remains the same if needed for other purposes
// export class NodeCanvasFactory { ... }
