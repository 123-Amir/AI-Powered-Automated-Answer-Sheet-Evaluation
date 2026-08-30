const express = require("express");
const multer = require("multer");
const { SUPPORTED_MIME_TYPES } = require("../utils/questionExtractor");
const { createJob } = require("../utils/jobStore");
const { runAssessmentPipeline } = require("../utils/assessmentPipeline");

const router = express.Router();

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // matches Phase 1/2 limits

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    // Never trust the filename/extension alone — validate the actual
    // detected MIME type multer reports for each part.
    if (SUPPORTED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type "${file.mimetype}" for field "${file.fieldname}".`));
    }
  },
});

const uploadBoth = upload.fields([
  { name: "questionPaper", maxCount: 1 },
  { name: "answerSheet", maxCount: 1 },
]);

/**
 * POST /api/assessment/process
 *
 * Accepts BOTH a question paper and an answer sheet in one request
 * (fields "questionPaper" and "answerSheet"), creates a job, responds
 * immediately with the jobId, and runs the Phase 1->2->3 pipeline
 * asynchronously in the background (see assessmentPipeline.js). The
 * frontend polls GET /api/assessment/status/:jobId for progress.
 */
router.post("/process", (req, res) => {
  uploadBoth(req, res, (err) => {
    if (err) {
      const statusCode = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? 400 : 400;
      return res.status(statusCode).json({ success: false, error: err.message });
    }

    const questionPaperFile = req.files?.questionPaper?.[0];
    const answerSheetFile = req.files?.answerSheet?.[0];

    if (!questionPaperFile || !answerSheetFile) {
      const missing = [];
      if (!questionPaperFile) missing.push("questionPaper");
      if (!answerSheetFile) missing.push("answerSheet");
      return res.status(400).json({
        success: false,
        error: `Missing required file(s): ${missing.join(", ")}. Both a question paper and an answer sheet are required.`,
      });
    }

    const job = createJob({
      questionPaper: { filename: questionPaperFile.originalname, mimeType: questionPaperFile.mimetype },
      answerSheet: { filename: answerSheetFile.originalname, mimeType: answerSheetFile.mimetype },
    });

    // Respond immediately — do not block the HTTP request on the full
    // AI pipeline. The pipeline runs detached; runAssessmentPipeline()
    // never throws (it captures its own errors into the job's error
    // state), so this fire-and-forget call is safe.
    runAssessmentPipeline(job.jobId, {
      questionPaperBuffer: questionPaperFile.buffer,
      questionPaperMimeType: questionPaperFile.mimetype,
      answerSheetBuffer: answerSheetFile.buffer,
      answerSheetMimeType: answerSheetFile.mimetype,
    });

    return res.status(200).json({ success: true, jobId: job.jobId, status: job.status });
  });
});

module.exports = router;
