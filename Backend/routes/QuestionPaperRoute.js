const express = require("express");
const multer = require("multer");
const {
  extractQuestionsFromDocument,
  QuestionExtractionError,
  SUPPORTED_MIME_TYPES,
} = require("../utils/questionExtractor");

const router = express.Router();

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB, matches existing frontend Upload.jsx limit

// Reject unsupported files up front (correct MIME-type detection —
// unlike the old geminiExtractor.js flow, we never assume/force PNG).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (SUPPORTED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new QuestionExtractionError(
        `Unsupported file type "${file.mimetype}". Supported types: ${SUPPORTED_MIME_TYPES.join(", ")}`,
        400
      ));
    }
  },
});

/**
 * POST /api/question-paper
 *
 * Accepts ONE question-paper file (PDF, JPG/JPEG, or PNG) under the
 * "questionPaper" field name, extracts questions via Gemini Vision, and
 * returns a normalized, ordered Question[] array.
 *
 * This route is intentionally isolated from the existing
 * /api/evaluations flow — it does not touch Evaluation.js, does not
 * require reference answers, and does not persist anything to MongoDB
 * (see models/QuestionPaper.js header comment for why).
 */
router.post("/", upload.single("questionPaper"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No question paper file was uploaded. Expected field name \"questionPaper\".",
      });
    }

    const questions = await extractQuestionsFromDocument(
      req.file.buffer,
      req.file.mimetype
    );

    if (!questions || questions.length === 0) {
      return res.status(422).json({
        success: false,
        error: "No questions could be extracted from the uploaded document.",
      });
    }

    return res.status(200).json({
      success: true,
      questions,
    });
  } catch (error) {
    const statusCode = error instanceof QuestionExtractionError ? error.statusCode : 500;
    console.error("🚨 Question paper extraction error:", error);
    return res.status(statusCode).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

// Multer errors (e.g. file too large, rejected by fileFilter) land here
// because they're thrown/passed before the async handler above runs.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? `File too large. Maximum allowed size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`
        : err.message;
    return res.status(400).json({ success: false, error: message });
  }
  if (err instanceof QuestionExtractionError) {
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }
  if (err) {
    console.error("🚨 Unexpected error in QuestionPaperRoute:", err);
    return res.status(500).json({ success: false, error: "Internal Server Error" });
  }
  next();
});

module.exports = router;
