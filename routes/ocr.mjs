// rn-infra/routes/ocr.mjs
import express from "express";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import config from "../config/index.mjs";
import { runOcrScript } from "../utils/index.mjs";
import ensureAuthenticated from "../middleware/authGuard.mjs";

const router = express.Router();

// --- Apply Auth Guard to all routes in this file ---
router.use(ensureAuthenticated);

// POST /api/ocr/start
router.post("/start", (req, res) => {
  // --- User is already authenticated here thanks to router.use(ensureAuthenticated) ---
  console.log(
    `Authenticated user starting OCR: ${req.user.username} (ID: ${req.user.id})`
  );

  const imagePath = path.join(
    config.DATA_DIR,
    `${config.OUTPUT_FILENAME_BASE}.png`
  );
  const overrides = req.body?.overrides || {};
  const jobId = randomUUID();
  const resultFilePath = path.join(config.OCR_RESULTS_DIR, `${jobId}.json`);
  const errorFilePath = path.join(config.OCR_RESULTS_DIR, `${jobId}.error`);

  console.log(`OCR Start Request | Job ID: ${jobId} | Overrides:`, overrides);
  console.log(`OCR Start Request | Result File Path: ${resultFilePath}`);
  console.log(`OCR Start Request | Error File Path: ${errorFilePath}`);

  // Immediately respond to the client that the job is accepted
  res.status(202).json({
    message: "OCR process accepted and started.",
    jobId: jobId,
    statusUrl: `/api/ocr/result/${jobId}`, // Corrected URL prefix
  });

  // --- Run OCR in Background ---
  setImmediate(async () => {
    console.log(`[Job ${jobId}] Starting background OCR process...`);
    let step = "check_image"; // Track progress
    try {
      // 1. Check image
      console.log(`[Job ${jobId} | ${step}] Checking for image: ${imagePath}`);
      await fs.access(imagePath, fs.constants.R_OK);
      console.log(`[Job ${jobId} | ${step}] Found preprocessed image.`);

      // 2. Run Meta Script
      step = "run_meta";
      console.log(`[Job ${jobId} | ${step}] Executing metadata script...`);
      const metaOutputJsonString = await runOcrScript(
        config.META_SCRIPT_PATH,
        overrides
      );
      console.log(
        `[Job ${jobId} | ${step}] Meta script finished. Output length: ${
          metaOutputJsonString?.length || 0
        }`
      );
      // Optional detailed logging:
      // console.log(`[Job ${jobId} | ${step}] Meta script raw output snippet: ${metaOutputJsonString?.substring(0,100)}...`);

      // 3. Run Transaction Script
      step = "run_tx";
      console.log(`[Job ${jobId} | ${step}] Executing transaction script...`);
      const txOutputJsonString = await runOcrScript(
        config.TX_SCRIPT_PATH,
        overrides
      );
      console.log(
        `[Job ${jobId} | ${step}] Tx script finished. Output length: ${
          txOutputJsonString?.length || 0
        }`
      );
      // Optional detailed logging:
      // console.log(`[Job ${jobId} | ${step}] Tx script raw output snippet: ${txOutputJsonString?.substring(0,100)}...`);

      // 4. Parse results
      step = "parse_results";
      console.log(`[Job ${jobId} | ${step}] Parsing script outputs...`);
      // Add validation here if needed - runOcrScript already tries basic JSON parse
      const metadata = JSON.parse(metaOutputJsonString);
      const transactions = JSON.parse(txOutputJsonString);
      console.log(`[Job ${jobId} | ${step}] Parsing successful.`);

      // 5. Combine into final structure
      step = "combine_results";
      console.log(`[Job ${jobId} | ${step}] Combining results...`);
      const finalResult = {
        // IMPORTANT: Set final status correctly
        status: "completed",
        jobId: jobId, // Include Job ID in result for reference
        completedAt: new Date().toISOString(), // Add timestamp
        metadata: metadata,
        transactions: transactions,
      };

      // 6. Save the successful result
      step = "write_result_file";
      console.log(
        `[Job ${jobId} | ${step}] Attempting to write result file: ${resultFilePath}`
      );
      await fs.writeFile(resultFilePath, JSON.stringify(finalResult, null, 2));
      console.log(
        `[Job ${jobId} | ${step}] Successfully saved result file: ${resultFilePath}`
      );
    } catch (error) {
      // Handle errors from any step
      console.error(
        `[Job ${jobId}] ERROR during background OCR at step '${step}':`,
        error
      );
      // Log specific details if available from runOcrScript errors or JSON parse errors
      if (error.stderr)
        console.error(
          `[Job ${jobId}] Stderr from failed script:`,
          error.stderr
        );
      if (error.stdout)
        console.error(
          `[Job ${jobId}] Stdout from failed script:`,
          error.stdout
        );
      if (!error.stderr && !error.stdout) {
        // Log stack for JS errors (like JSON.parse)
        console.error(`[Job ${jobId}] Stack trace:`, error.stack);
      }

      // Attempt to save error details for polling
      try {
        console.log(
          `[Job ${jobId}] Attempting to write error file: ${errorFilePath}`
        );
        const errorInfo = {
          // IMPORTANT: Set final status correctly
          status: "failed",
          jobId: jobId, // Include Job ID for reference
          failedAt: new Date().toISOString(), // Add timestamp
          error: {
            step: step, // Indicate where it failed
            message: error.message || "Unknown processing error",
            // Include script output if available
            stderr: error.stderr || null,
            stdout: error.stdout || null,
            // Add stack trace for JS errors
            stack: error.stack || null,
          },
        };
        await fs.writeFile(errorFilePath, JSON.stringify(errorInfo, null, 2));
        console.log(
          `[Job ${jobId}] Successfully saved error details: ${errorFilePath}`
        );
      } catch (writeError) {
        console.error(
          `[Job ${jobId}] CRITICAL: Failed to write error file ${errorFilePath} after processing error:`,
          writeError
        );
        // If writing the error file fails, the job will likely remain 'pending' indefinitely from the client's perspective
      }
    }
  }); // End setImmediate
});

// GET /api/ocr/result/:jobId
router.get("/result/:jobId", async (req, res) => {
  // --- User is already authenticated ---
  console.log(
    `Authenticated user checking OCR result: ${
      req.user?.username || "UnknownUser"
    } (ID: ${req.user?.id || "N/A"})`
  ); // Safe access to user
  const jobId = req.params.jobId;
  console.log(`[Result Endpoint | Job ${jobId}] Received request.`);

  if (!jobId || !/^[a-f0-9-]+$/.test(jobId)) {
    console.log(`[Result Endpoint | Job ${jobId}] Invalid Job ID format.`);
    return res.status(400).json({ error: "Invalid or missing Job ID format." });
  }

  const resultFilePath = path.join(config.OCR_RESULTS_DIR, `${jobId}.json`);
  const errorFilePath = path.join(config.OCR_RESULTS_DIR, `${jobId}.error`);
  console.log(
    `[Result Endpoint | Job ${jobId}] Checking for error file: ${errorFilePath}`
  );
  console.log(
    `[Result Endpoint | Job ${jobId}] Checking for result file: ${resultFilePath}`
  );

  let errorFileFound = false;
  let resultFileFound = false;

  try {
    // Check for error file first
    try {
      console.log(
        `[Result Endpoint | Job ${jobId}] Attempting to read error file...`
      );
      const errorData = await fs.readFile(errorFilePath, "utf-8");
      errorFileFound = true; // Mark as found
      console.log(
        `[Result Endpoint | Job ${jobId}] Found and read error file. Parsing...`
      );
      try {
        const errorJson = JSON.parse(errorData);
        errorJson.status = "failed"; // Ensure status
        console.log(
          `[Result Endpoint | Job ${jobId}] Parsed error file. Returning 500.`
        );
        return res.status(500).json(errorJson); // Send parsed error JSON
      } catch (parseErr) {
        console.error(
          `[Result Endpoint | Job ${jobId}] Error parsing error file contents: ${parseErr}`
        );
        return res.status(500).json({
          status: "failed",
          jobId: jobId,
          error: { message: "OCR failed, error details file is corrupted." },
        });
      }
    } catch (err) {
      // Log the specific error when trying to read the error file
      console.log(
        `[Result Endpoint | Job ${jobId}] Error reading error file: Code=${err.code}, Message=${err.message}`
      );
      if (err.code !== "ENOENT") {
        // If it's not ENOENT, it's an unexpected error (permissions?)
        console.error(
          `[Result Endpoint | Job ${jobId}] Unexpected error reading error file (NOT ENOENT):`,
          err
        );
        throw err; // Re-throw to be caught by the outer try/catch
      }
      // ENOENT is expected if job hasn't failed
      console.log(
        `[Result Endpoint | Job ${jobId}] Error file not found (ENOENT), proceeding...`
      );
    }

    // Check for result file ONLY if no error file was found
    if (!errorFileFound) {
      try {
        console.log(
          `[Result Endpoint | Job ${jobId}] Attempting to read result file...`
        );
        const jsonData = await fs.readFile(resultFilePath, "utf-8");
        resultFileFound = true; // Mark as found
        console.log(
          `[Result Endpoint | Job ${jobId}] Found and read result file. Parsing...`
        );
        try {
          const resultJson = JSON.parse(jsonData);
          resultJson.status = "completed"; // Ensure status
          console.log(
            `[Result Endpoint | Job ${jobId}] Parsed result file. Returning 200.`
          );
          res.setHeader("Content-Type", "application/json");
          return res.status(200).json(resultJson); // Send parsed result JSON
        } catch (parseErr) {
          console.error(
            `[Result Endpoint | Job ${jobId}] Error parsing result file contents: ${parseErr}`
          );
          return res.status(500).json({
            status: "error",
            jobId: jobId,
            error: { message: "OCR result file is corrupted." },
          });
        }
      } catch (err) {
        // Log the specific error when trying to read the result file
        console.log(
          `[Result Endpoint | Job ${jobId}] Error reading result file: Code=${err.code}, Message=${err.message}`
        );
        if (err.code !== "ENOENT") {
          // If it's not ENOENT, it's an unexpected error (permissions?)
          console.error(
            `[Result Endpoint | Job ${jobId}] Unexpected error reading result file (NOT ENOENT):`,
            err
          );
          throw err; // Re-throw to be caught by the outer try/catch
        }
        // ENOENT is expected if job is pending or failed
        console.log(
          `[Result Endpoint | Job ${jobId}] Result file not found (ENOENT).`
        );
      }
    }

    // If neither file was successfully found and processed, assume pending
    if (!errorFileFound && !resultFileFound) {
      console.log(
        `[Result Endpoint | Job ${jobId}] Pending: No result or error file processed. Returning 202.`
      );
      return res.status(202).json({ status: "pending", jobId: jobId });
    }
    // Fallback: Should ideally not be reached if logic above is sound
    console.warn(
      `[Result Endpoint | Job ${jobId}] Reached unexpected end of logic flow. Returning pending as fallback.`
    );
    return res.status(202).json({ status: "pending", jobId: jobId });
  } catch (error) {
    // Catch errors from re-throws above (e.g., permission errors)
    console.error(
      `[Result Endpoint | Job ${jobId}] Outer catch block error during status check:`,
      error
    );
    return res.status(500).json({
      status: "error", // Indicate a server-side check error
      jobId: jobId,
      error: { message: `Server error checking job status: ${error.message}` },
    });
  }
});

export default router;
