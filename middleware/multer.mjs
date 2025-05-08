import multer from "multer";
import path from "path";
import config from "../config/index.mjs"; // Import config

const storage = multer.diskStorage({
  destination: config.UPLOAD_DIR,
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const fileFilter = (req, file, cb) => {
  console.log(
    `[Multer fileFilter] Received file: ${file.originalname}, Original MIME: ${file.mimetype}`
  );

  config.ALLOWED_MIMETYPES.includes(file.mimetype)
    ? cb(null, true)
    : cb(new Error(`Invalid file type: ${file.mimetype}`), false);
};

export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

export default upload; // Default export is fine too
