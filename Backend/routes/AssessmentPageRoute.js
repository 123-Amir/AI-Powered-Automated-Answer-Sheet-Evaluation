const express = require("express");
const { getJob, getPageImage } = require("../utils/jobStore");

const router = express.Router();

/**
 * GET /api/assessment/:jobId/page/:pageNumber
 *
 * Serves a rendered answer-sheet page image directly from the in-memory
 * store populated by the assessment pipeline (see jobStore.js /
 * assessmentPipeline.js). Never touches the filesystem and never
 * returns a path — only the raw image bytes with the correct
 * Content-Type, or a 404.
 */
router.get("/:jobId/page/:pageNumber", (req, res) => {
  const { jobId, pageNumber } = req.params;

  const job = getJob(jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: "Job not found. It may have expired or the jobId is invalid." });
  }

  const pageNum = Number(pageNumber);
  if (!Number.isInteger(pageNum) || pageNum < 1) {
    return res.status(400).json({ success: false, error: "Invalid page number." });
  }

  const image = getPageImage(jobId, pageNum);
  if (!image) {
    return res.status(404).json({ success: false, error: `Page ${pageNum} was not found for this job.` });
  }

  res.setHeader("Content-Type", image.mimeType);
  // These bytes never change once a job is complete — safe to cache
  // for the lifetime of the job on the client side.
  res.setHeader("Cache-Control", "private, max-age=1800");
  return res.status(200).send(image.buffer);
});

module.exports = router;
