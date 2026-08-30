const express = require("express");
const { getJob } = require("../utils/jobStore");

const router = express.Router();

/**
 * GET /api/assessment/status/:jobId
 *
 * Polled by the frontend to track progress and retrieve the final
 * result once processing completes.
 */
router.get("/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: "Job not found. It may have expired or the jobId is invalid.",
    });
  }

  if (job.status === "error") {
    return res.status(200).json({
      success: false,
      jobId: job.jobId,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      message: job.message,
      error: job.error,
    });
  }

  const response = {
    success: true,
    jobId: job.jobId,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
  };

  if (job.status === "completed") {
    response.result = job.result;
  }

  // Phase 6: surfaced only once grading has been triggered for this
  // job (see GradingRoute.js) — lets the frontend poll this SAME
  // endpoint for live grading progress instead of adding a new route.
  if (job.grading) {
    response.grading = job.grading;
  }

  return res.status(200).json(response);
});

module.exports = router;
