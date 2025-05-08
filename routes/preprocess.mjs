import express from "express";
import path from "path";
import fs from "fs/promises";
import config from "../config/index.mjs";
import upload from "../middleware/multer.mjs"; // Use the exported middleware
import { convertPdfToImage, optimizeAndSaveImage } from "../utils/index.mjs"; // Use helpers

const router = express.Router();

// POST /preprocess
router.post("/", upload.single("file"), async (req, res, next) => {
  // Added next for error handling
  if (!req.file) {
    // Multer error or no file
    return res
      .status(400)
      .json({ error: "No file uploaded or invalid file type." });
  }
  console.log(
    `Preprocessing route: ${req.file.originalname} (${req.file.mimetype})`
  );

  const tempPath = req.file.path;
  const outBase = path.join(config.DATA_DIR, config.OUTPUT_FILENAME_BASE);
  let finalImagePath = ""; // Store the final path for potential cleanup on error

  try {
    let imageBuffer;
    // Determine input type and convert if necessary
    if (req.file.mimetype === "application/pdf") {
      imageBuffer = await convertPdfToImage(
        tempPath,
        config.TARGET_IMAGE_WIDTH
      );
    } else if (config.ALLOWED_MIMETYPES.includes(req.file.mimetype)) {
      // For allowed image types, read the uploaded file directly
      imageBuffer = await fs.readFile(tempPath);
    } else {
      // This case should ideally be caught by Multer's fileFilter, but double-check
      throw new Error(`Unsupported file type processed: ${req.file.mimetype}`);
    }

    // Optimize and save the image (always save as PNG for consistency)
    finalImagePath = await optimizeAndSaveImage(
      imageBuffer,
      outBase,
      config.TARGET_IMAGE_WIDTH,
      "png" // Force PNG output
    );

    // Success response
    res.status(200).json({
      message: "File preprocessed successfully.",
      imageFilename: path.basename(finalImagePath),
      // Optional: provide path relative to DATA_DIR or absolute path if needed client-side
      // Note: The absolute path is less portable/secure to expose directly
      // relativeImagePath: path.relative(config.DATA_DIR, finalImagePath),
      absoluteImagePath: finalImagePath, // Included for debugging/local use
    });
  } catch (error) {
    console.error("Preprocessing error:", error);
    // Clean up potentially generated image if error occurred after saving it
    if (finalImagePath) {
      try {
        await fs.unlink(finalImagePath);
      } catch (e) {
        console.error("Cleanup failed for", finalImagePath, e);
      }
    }
    // Pass error to the global error handler
    next(error);
  } finally {
    // Always try to clean up the original upload
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
        console.log(`Deleted temporary upload: ${tempPath}`);
      } catch (e) {
        console.error(`Failed to delete temporary upload ${tempPath}:`, e);
      }
    }
  }
});

export default router;
