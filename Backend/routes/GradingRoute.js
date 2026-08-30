const express = require("express");
const { getJob, updateJob } = require("../utils/jobStore");
const { evaluateAssessment, summarizeGrading } = require("../utils/gradingEngine");

const router = express.Router();

/**
 * POST /api/assessment/:jobId/grade
 *
 * Grades a COMPLETED assessment job (Phase 4/5 result) by evaluating
 * every matched question's combined answer text against its question
 * text via Gemini. Runs synchronously and returns the full result —
 * but updates job.grading incrementally as it goes (see gradingEngine's
 * onProgress callback), so a concurrent GET /api/assessment/status/:jobId
 * request made while this is in flight reflects real, live progress
 * without needing a second dedicated polling endpoint.
 *
 * Deliberately NOT run automatically during Phase 4's extraction
 * pipeline (Phase 6 section 11) — the teacher must explicitly trigger
 * this after reviewing the extraction/mapping result.
 */
router.post("/:jobId/grade", async (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: "Job not found. It may have expired or the jobId is invalid.",
    });
  }

  if (job.status !== "completed" || !job.result) {
    return res.status(409).json({
      success: false,
      error: "This assessment has not finished processing yet. Wait for extraction/mapping to complete before grading.",
    });
  }

  const { questions, mappings, unmatchedAnswers, answerBlocks } = job.result;

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(422).json({
      success: false,
      error: "This assessment has no extracted questions to grade.",
    });
  }

  try {
    updateJob(jobId, {
      grading: { status: "grading", progress: 0, message: "Starting evaluation...", current: 0, total: 0 },
    });

    const results = await evaluateAssessment(questions, answerBlocks, mappings, ({ current, total, questionLabel }) => {
      const progress = total > 0 ? Math.round((current / total) * 100) : 0;
      updateJob(jobId, {
        grading: {
          status: "grading",
          progress,
          message: `Evaluating question ${current} of ${total}${questionLabel ? ` (${questionLabel})` : ""}...`,
          current,
          total,
        },
      });
    });

    const summary = summarizeGrading(questions, mappings, results, unmatchedAnswers);

    // Persist the grading result on the job so a later status poll (or
    // page refresh) can retrieve it without re-running evaluation.
    updateJob(jobId, {
      grading: { status: "completed", progress: 100, message: "Grading complete.", current: results.length, total: results.length },
      result: { ...job.result, evaluationResults: results, gradingSummary: summary },
    });

    return res.status(200).json({
      success: true,
      results,
      summary,
      unmatchedAnswers,
    });
  } catch (err) {
    console.error(`🚨 [GradingRoute] Grading failed for job ${jobId}:`, err);
    updateJob(jobId, {
      grading: { status: "error", progress: 0, message: "Grading failed.", current: 0, total: 0 },
    });
    return res.status(500).json({
      success: false,
      error: "Unable to grade this assessment due to an internal error.",
    });
  }
});

module.exports = router;
