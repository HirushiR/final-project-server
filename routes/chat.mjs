// rn-infra/routes/chat.mjs
import express from "express";
import config from "../config/index.mjs";
import { isLlamaServerRunning, startLlamaServer } from "../utils/index.mjs";
import ensureAuthenticated from "../middleware/authGuard.mjs"; // <-- Import the guard

const router = express.Router();

// --- Apply Auth Guard to all routes in this file ---
router.use(ensureAuthenticated); // <--- Protect all chat routes

let isStartingServer = false;

// POST /api/chat/completions - Passthrough Endpoint
router.post("/completions", async (req, res, next) => {
  // --- User is already authenticated here thanks to router.use(ensureAuthenticated) ---
  console.log(
    `Authenticated user accessing chat: ${req.user.username} (ID: ${req.user.id})`
  );

  const targetUrl = `${config.LLAMA_SERVER_URL}/v1/chat/completions`;
  console.log(`Chat Passthrough: Request received for ${targetUrl}`);

  // ... (rest of the chat completion logic remains the same)
  const isStreaming = req.body?.stream === true;
  // ... try/catch block ...
  try {
    // --- START: Check and Start Server Logic ---
    if (!isStartingServer) {
      // Prevent multiple start attempts concurrently
      const isRunning = await isLlamaServerRunning();
      if (!isRunning) {
        isStartingServer = true; // Set lock
        console.log(
          "Chat Passthrough: llama-server not detected. Attempting to start..."
        );
        const started = startLlamaServer();
        if (started) {
          // Give the server a moment to initialize before the first request
          console.log(
            "Chat Passthrough: Waiting briefly for server to initialize..."
          );
          await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds (adjust as needed)
          console.log(
            "Chat Passthrough: Proceeding with request after auto-start attempt."
          );
        } else {
          console.error("Chat Passthrough: Failed to start llama-server.");
          isStartingServer = false; // Release lock if start failed
          // Optionally return an error immediately
          return res
            .status(503)
            .json({ error: "Chat server is offline and failed to start." });
        }
        isStartingServer = false; // Release lock after attempt+wait
      } else {
        console.log("Chat Passthrough: llama-server appears to be running.");
      }
    } else {
      console.log(
        "Chat Passthrough: Server start already in progress, proceeding with request..."
      );
    }
    // --- END: Check and Start Server Logic ---

    console.log(`Chat Passthrough: Forwarding request to ${targetUrl}`);
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: req.headers.accept || "application/json, text/event-stream",
      },
      body: JSON.stringify(req.body),
    });

    // ... (rest of the response handling logic remains the same) ...
    res.status(response.status);
    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Chat Passthrough Error ${response.status}: ${errorText}`);
      // Avoid sending potentially sensitive internal errors directly?
      next(
        new Error(`Chat server request failed with status ${response.status}`)
      );
      return; // Important: stop processing here
    }

    if (isStreaming && response.body) {
      console.log("Chat Passthrough: Streaming response...");
      res.setHeader("Content-Type", "text/event-stream"); // Ensure correct header for SSE
      try {
        for await (const chunk of response.body) {
          if (!res.write(chunk)) {
            // Handle backpressure if needed (rare for typical chat)
            await new Promise((resolve) => res.once("drain", resolve));
          }
        }
        res.end();
        console.log("Chat Passthrough: Stream finished.");
      } catch (streamError) {
        console.error("Chat Passthrough: Error during streaming:", streamError);
        // Don't try to write further if headers already sent
        if (!res.headersSent) {
          next(new Error(`Stream error: ${streamError.message}`));
        } else {
          console.error("Cannot send error response, headers already sent.");
          res.end(); // Try to end the response gracefully
        }
      }
    } else if (response.body) {
      console.log("Chat Passthrough: Non-streaming response.");
      // Need to handle potential JSON parse errors here
      try {
        const data = await response.json();
        res.json(data);
      } catch (parseError) {
        console.error(
          "Chat Passthrough: Error parsing non-streaming JSON response:",
          parseError
        );
        next(new Error("Failed to parse response from chat server."));
      }
    } else {
      console.log("Chat Passthrough: Response has no body.");
      res.status(204).end(); // No content
    }
  } catch (error) {
    // Check if the error is specifically a connection refused error after attempting auto-start
    if (error.code === "ECONNREFUSED" && !isStartingServer) {
      // Only if not actively starting
      console.error(
        "Chat Passthrough Error: Connection refused. Server might have stopped or failed to start properly.",
        error
      );
      next(new Error(`Chat server is unavailable.`));
    } else {
      console.error("Chat Passthrough Fetch/Network Error:", error);
      next(
        new Error(
          `Failed to connect or communicate with chat server: ${error.message}`
        )
      );
    }
    // Reset starting flag if fetch fails, allowing another attempt later
    if (isStartingServer) isStartingServer = false;
  }
});

export default router;
