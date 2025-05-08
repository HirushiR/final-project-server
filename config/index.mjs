// rn-infra/config/index.mjs
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto"; // Keep crypto for password hashing

// --- Optional: Load .env file if you're using one ---
import dotenv from "dotenv";
dotenv.config();
// ----------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __basedir = path.dirname(path.dirname(__filename));

// --- JWT Config ---
export const JWT_SECRET = process.env.JWT_SECRET;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d"; // Default expiry

if (!JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET environment variable is not set.");
  process.exit(1);
}
// -----------------

export const PORT = process.env.PORT || 12345;
// ... (rest of your config variables: UPLOAD_DIR, DATA_DIR, etc.)
export const UPLOAD_DIR = path.join(__basedir, "uploads");
export const DATA_DIR = path.join(__basedir, "data");
export const OCR_RESULTS_DIR = path.join(__basedir, "ocr_results");
export const OUTPUT_FILENAME_BASE = "temp";
export const TARGET_IMAGE_WIDTH = 720;
export const ALLOWED_MIMETYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
];
export const META_SCRIPT_PATH = path.join(__basedir, "ocr_meta.py");
export const TX_SCRIPT_PATH = path.join(__basedir, "ocr_tx.py");
export const CHAT_SCRIPT_PATH = path.join(__basedir, "chat.py");
export const PYTHON_EXECUTABLE = process.env.PYTHON_EXECUTABLE || "python3";
export const LLAMA_SERVER_URL =
  process.env.LLAMA_SERVER_URL || "http://localhost:4000";

export default {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  PORT,
  UPLOAD_DIR,
  DATA_DIR,
  OCR_RESULTS_DIR,
  OUTPUT_FILENAME_BASE,
  TARGET_IMAGE_WIDTH,
  ALLOWED_MIMETYPES,
  META_SCRIPT_PATH,
  TX_SCRIPT_PATH,
  CHAT_SCRIPT_PATH,
  PYTHON_EXECUTABLE,
  LLAMA_SERVER_URL,
};
