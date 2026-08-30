/**
 * EvaluationResult shape + enums for Phase 6 AI grading.
 *
 * The existing project's old evaluator (utils/geminiHelper.js) has NO
 * established correctness taxonomy — it only produces a raw X/5 score
 * plus a free-text comment via regex parsing. Per the Phase 6 spec
 * ("do not invent a correctness category if the existing evaluator
 * already has one... reuse existing terminology when practical"),
 * since no such taxonomy exists to reuse, the categories below are
 * newly defined here, matching the spec's own example exactly.
 *
 * Not a Mongoose model in active use — like models/QuestionPaper.js
 * and models/ProcessingStatus.js before it, this documents the shape;
 * grading results are kept in-memory on the job (see jobStore.js), no
 * database persistence is introduced for this phase.
 */

const STATUS_VALUES = ["evaluated", "unanswered", "unmatched", "error"];

const CORRECTNESS_VALUES = [
  "correct",
  "mostly_correct",
  "partially_correct",
  "incorrect",
  "unanswered",
];

/**
 * @typedef {object} EvaluationResult
 * @property {string} questionId
 * @property {"evaluated"|"unanswered"|"unmatched"|"error"} status
 * @property {number|null} marksAwarded
 * @property {number|null} marksPossible
 * @property {number|null} percentage
 * @property {"correct"|"mostly_correct"|"partially_correct"|"incorrect"|"unanswered"|null} correctness
 * @property {string} feedback
 * @property {string[]} strengths
 * @property {string[]} improvements
 * @property {number|null} confidence
 */

function createUnansweredResult(question) {
  return {
    questionId: question.id,
    status: "unanswered",
    marksAwarded: 0,
    marksPossible: question.marksPossible ?? null,
    percentage: 0,
    correctness: "unanswered",
    feedback: "No answer was detected for this question.",
    strengths: [],
    improvements: [],
    confidence: null,
  };
}

function createErrorResult(question, errorMessage) {
  return {
    questionId: question.id,
    status: "error",
    marksAwarded: null,
    marksPossible: question.marksPossible ?? null,
    percentage: null,
    correctness: null,
    feedback: errorMessage || "This question could not be evaluated due to an internal error.",
    strengths: [],
    improvements: [],
    confidence: null,
  };
}

module.exports = {
  STATUS_VALUES,
  CORRECTNESS_VALUES,
  createUnansweredResult,
  createErrorResult,
};
