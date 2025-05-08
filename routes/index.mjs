import express from "express";
import preprocessRouter from "./preprocess.mjs";
import ocrRouter from "./ocr.mjs";
import chatRouter from "./chat.mjs";

const router = express.Router();

// Mount the specific routers
router.use("/preprocess", preprocessRouter);
router.use("/ocr", ocrRouter);
router.use("/chat", chatRouter);

// You could add other top-level routes here if needed

export default router;
