const express = require("express");
const multer = require("multer");
const {
  extractAnswersFromDocument,
  AnswerExtractionError,
  SUPPORTED_MIME_TYPES,
} = require("../utils/answerSheetExtractor");

const router = express.Router();

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // matches Phase 1 / existing frontend limit

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (SUPPORTED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AnswerExtractionError(
        `Unsupported file type "${file.mimetype}". Supported types: ${SUPPORTED_MIME_TYPES.join(", ")}`,
        400
      ));
    }
  },
});

/**
 * POST /api/answer-sheet
 *
 * Accepts ONE student answer-sheet file (PDF, JPG/JPEG, or PNG) under
 * the "answerSheet" field name, extracts handwritten answer blocks
 * (with page, bounding box, confidence) via Gemini Vision, and returns
 * normalized AnswerBlock[] plus per-page metadata.
 *
 * Isolated from the existing /api/evaluations flow and from Phase 1's
 * /api/question-paper — no mapping between questions and answers
 * happens here (that's Phase 3), and nothing is persisted to MongoDB.
 */
router.post("/", upload.single("answerSheet"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No answer sheet file was uploaded. Expected field name \"answerSheet\".",
      });
    }

    const { pages, answers } = await extractAnswersFromDocument(
      req.file.buffer,
      req.file.mimetype
    );

    return res.status(200).json({
      success: true,
      // pagesMeta now also carries raw image buffers for Phase 5's
      // internal use (via the assessment pipeline) — strip them here
      // so this endpoint's JSON contract stays exactly as documented
      // in Phase 2 (a raw Buffer would otherwise serialize as a huge
      // byte-array instead of the intended {pageNumber,widthPx,heightPx}).
      pages: pages.map(({ pageNumber, widthPx, heightPx }) => ({ pageNumber, widthPx, heightPx })),
      answers,
    });
  } catch (error) {
    const statusCode = error instanceof AnswerExtractionError ? error.statusCode : 500;
    console.error("🚨 Answer sheet extraction error:", error);
    return res.status(statusCode).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? `File too large. Maximum allowed size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`
        : err.message;
    return res.status(400).json({ success: false, error: message });
  }
  if (err instanceof AnswerExtractionError) {
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }
  if (err) {
    console.error("🚨 Unexpected error in AnswerSheetRoute:", err);
    return res.status(500).json({ success: false, error: "Internal Server Error" });
  }
  next();
});

module.exports = router;
