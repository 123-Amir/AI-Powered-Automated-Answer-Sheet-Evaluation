/**
 * ProcessingStatus shape reference + factory.
 *
 * DESIGN DECISION: this is a plain JS module, NOT a Mongoose model.
 * The assignment explicitly says no database is required, and jobs
 * here are short-lived, single-request-lifecycle objects — persisting
 * them to MongoDB would add a dependency (a live DB connection) that
 * the processing pipeline doesn't otherwise need, and would complicate
 * cleanup (TTL logic is trivial in-memory, needs a cron/TTL-index
 * dance in Mongo). The existing app DOES already use MongoDB (for
 * Evaluation/User), so it would have been "available" — but adding
 * writes to it here isn't "substantially simpler", it's strictly more
 * moving parts for a value that's thrown away shortly after the
 * teacher reads the result. Hence: in-memory store (see jobStore.js).
 *
 * This file just documents the canonical shape and provides a factory
 * so every job object is created consistently.
 */

const STAGES = [
  "uploading",
  "extracting_questions",
  "extracting_answers",
  "mapping",
  "completed",
  "error",
];

const STATUSES = ["processing", "completed", "error"];

/**
 * @param {{ questionPaper: {filename:string, mimeType:string}, answerSheet: {filename:string, mimeType:string} }} meta
 * @param {string} jobId
 */
function createProcessingStatus(jobId, meta) {
  const now = new Date().toISOString();
  return {
    jobId,
    status: "processing",
    stage: "uploading",
    progress: 0,
    message: "Upload received, starting processing...",
    questionPaper: meta.questionPaper,
    answerSheet: meta.answerSheet,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

module.exports = { createProcessingStatus, STAGES, STATUSES };
