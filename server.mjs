// rn-infra/server.mjs
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
// import crypto from 'crypto'; // No longer needed for session patch

// --- Authentication & Session Imports ---
import passport from "passport"; // Keep passport
// import session from 'express-session'; // REMOVE
// import CustomBetterSqliteStore from './middleware/CustomBetterSqliteStore.mjs'; // REMOVE

// --- App Imports ---
import config from "./config/index.mjs";
import apiRouter from "./routes/index.mjs";
import authRouter from "./routes/auth.mjs"; // This file now configures passport strategies
import db from "./db/index.mjs";
import multer from "multer";
import cors from "cors";
import { runKillLlamaScript } from "./utils/index.mjs";

// --- Setup basedir ---
const __filename = fileURLToPath(import.meta.url);
const __basedir = path.dirname(__filename);

// --- Express App Setup ---
const app = express();

// --- REMOVE Session Store Setup ---
// const sessionStore = new CustomBetterSqliteStore(...)

// --- REMOVE PATCHES ---
// Patches for .on and .regenerate are removed

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- REMOVE Session Middleware ---
// app.use(session({...}));

// --- Passport Middleware ---
app.use(passport.initialize()); // Initialize Passport, NO session support needed
// app.use(passport.authenticate('session')); // REMOVE THIS

// --- Ensure Directories Exist ---
async function setupDirectories() {
  try {
    await fs.mkdir(path.join(__basedir, "var", "db"), { recursive: true }); // Keep for users.db
    await fs.mkdir(config.UPLOAD_DIR, { recursive: true });
    await fs.mkdir(config.DATA_DIR, { recursive: true });
    await fs.mkdir(config.OCR_RESULTS_DIR, { recursive: true });
    console.log(
      "Ensured directories exist:",
      config.UPLOAD_DIR,
      config.DATA_DIR,
      config.OCR_RESULTS_DIR,
      path.join(__basedir, "var", "db")
    );
  } catch (error) {
    console.error("Failed to create necessary directories:", error);
    process.exit(1);
  }
}

// --- Routes ---
app.use("/", authRouter); // Provides /login/password, /signup
app.use("/api", apiRouter); // Mounts under /api/* (protected routes use JWT guard)

app.get("/", (req, res) => {
  res.json({
    message: "OCR/Chat Processing Service API is running.",
    status: "OK (JWT Auth)",
  }); // Update message
});

app.post("/api/kill-llama", async (req, res, next) => {
  const forceKill = req.body?.force === true;
  console.log(
    `Received request to kill llama-server processes ${
      forceKill ? "(FORCE)" : "(graceful)"
    }...`
  );
  try {
    const { stdout, stderr } = await runKillLlamaScript(forceKill);
    console.log("kill_llama.sh stdout:\n", stdout);
    if (stderr) console.warn("kill_llama.sh stderr:\n", stderr);
    res.status(200).json({
      message: `Kill script executed ${
        forceKill ? "forcefully" : "gracefully"
      }. Check server logs for details.`,
      stdout: stdout,
      stderr: stderr,
    });
  } catch (error) {
    console.error("Error executing kill_llama.sh:", error);
    const augmentedError = new Error(
      `Failed to execute kill script: ${error.message}`
    );
    augmentedError.status = 500;
    augmentedError.stdout = error.stdout;
    augmentedError.stderr = error.stderr;
    next(augmentedError);
  }
});

// --- Global Error Handler ---
// ... (error handler remains largely the same, maybe adjust DB error codes if needed) ...
app.use((err, req, res, next) => {
  console.error("Global Error Handler Caught:", err.stack);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  }
  if (err.message?.startsWith("Invalid file type")) {
    return res.status(400).json({ error: err.message });
  }
  if (err.code && err.code.startsWith("SQLITE_") && !err.status) {
    return res
      .status(500)
      .json({ error: `Database error: ${err.code}`, details: err.message });
  }
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    console.warn("JWT Error caught by global handler:", err.message);
    return res
      .status(401)
      .json({ error: `Authentication Error: ${err.message}` });
  }
  if (err.code && typeof err.code === "string" && !err.status) {
    return res.status(500).json({
      error: `Server system error: ${err.code}`,
      details: err.message,
    });
  }

  const statusCode = err.status || 500;
  const errorMessage =
    statusCode === 500 && process.env.NODE_ENV === "production"
      ? "An internal server error occurred."
      : err.message || "An unexpected error occurred.";

  if (!res.headersSent) {
    res.status(statusCode).json({ error: errorMessage });
  } else {
    console.error(
      "Error occurred after headers were sent. Cannot send error response."
    );
    next(err);
  }
});

// --- Start Server ---
setupDirectories()
  .then(() => {
    app.listen(config.PORT, () => {
      console.log(`Server running on http://localhost:${config.PORT}`);
      console.log(
        `JWT Authentication endpoints: /login/password (POST), /signup (POST)`
      ); // Update log
      console.log(`API endpoints under /api protected by JWT`);
      console.log(`Using database via better-sqlite3: ${db.name}`);
      console.log(
        `JWT Secret: ${config.JWT_SECRET ? "SET" : "NOT SET (FATAL!)"}`
      );
      console.log(`JWT Expiry: ${config.JWT_EXPIRES_IN}`);
    });
  })
  .catch((err) => {
    console.error("Server failed to start:", err);
    process.exit(1);
  });
