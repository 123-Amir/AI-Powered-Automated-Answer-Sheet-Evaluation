/**
 * Orchestrates grading for a completed assessment: for every Question,
 * resolves its AnswerMapping, combines AnswerBlock text where needed,
 * and calls answerEvaluator.js — mirroring assessmentPipeline.js's
 * "thin orchestrator, reuse the real utility" shape from Phase 4.
 */

const { evaluateAnswer, EvaluationError } = require("./answerEvaluator");
const { createUnansweredResult, createErrorResult } = require("../models/EvaluationResult");

/**
 * Combines the text of a matched answer's blocks in physical order.
 * Per Phase 3's design, mapping.answerBlockIds are already stored in
 * page/chain order (root block first, then its continuations) — so a
 * straight join here already satisfies "page, then visual position",
 * it does NOT depend on whatever order the client might pass blocks in.
 */
function combineAnswerText(answerBlockIds, answerBlocksById) {
  return answerBlockIds
    .map((id) => answerBlocksById.get(id))
    .filter(Boolean)
    .map((block) => (block.text || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * @param {Array} questions
 * @param {Array} answerBlocks
 * @param {Array} mappings
 * @param {(progress:{current:number,total:number,questionLabel:string}) => void} [onProgress]
 * @returns {Promise<Array>} EvaluationResult[]
 */
async function evaluateAssessment(questions, answerBlocks, mappings, onProgress) {
  const mappingByQuestionId = new Map(mappings.map((m) => [m.questionId, m]));
  const answerBlocksById = new Map(answerBlocks.map((b) => [b.id, b]));

  const results = [];
  const matchedCount = mappings.filter((m) => m.status === "matched").length;
  let evaluatedSoFar = 0;

  // Sequential, controlled AI calls — matches Phase 4's precedent
  // (page-by-page extraction) and avoids overwhelming the API with
  // concurrent requests, per Phase 6 section 13.
  for (const question of questions) {
    const mapping = mappingByQuestionId.get(question.id);

    if (!mapping || mapping.status === "unanswered") {
      results.push(createUnansweredResult(question));
      continue;
    }

    const combinedAnswerText = combineAnswerText(mapping.answerBlockIds, answerBlocksById);

    if (!combinedAnswerText) {
      // Matched in mapping but somehow no usable text (e.g. blank
      // handwriting block) — treat as unanswered rather than sending
      // empty content to the model.
      results.push(createUnansweredResult(question));
      continue;
    }

    evaluatedSoFar += 1;
    if (typeof onProgress === "function") {
      onProgress({
        current: evaluatedSoFar,
        total: matchedCount,
        questionLabel: question.displayLabel,
      });
    }

    try {
      // eslint-disable-next-line no-await-in-loop -- intentionally sequential, see file header
      const evaluation = await evaluateAnswer({
        questionText: question.text,
        studentAnswer: combinedAnswerText,
        marksPossible: question.marksPossible ?? null,
      });

      const marksPossible = question.marksPossible ?? null;
      const percentage =
        marksPossible !== null && evaluation.marksAwarded !== null && marksPossible > 0
          ? Math.round((evaluation.marksAwarded / marksPossible) * 100)
          : null;

      results.push({
        questionId: question.id,
        status: "evaluated",
        marksAwarded: evaluation.marksAwarded,
        marksPossible,
        percentage,
        correctness: evaluation.correctness,
        feedback: evaluation.feedback,
        strengths: evaluation.strengths,
        improvements: evaluation.improvements,
        confidence: evaluation.confidence,
      });
    } catch (err) {
      // One failure must not abort the rest of the assessment (Phase 6
      // section 14) — log full detail server-side, keep the client-safe
      // message on the result itself.
      console.error(`🚨 [gradingEngine] Evaluation failed for question ${question.id}:`, err);
      const safeMessage =
        err instanceof EvaluationError
          ? err.message
          : "This question could not be evaluated due to an internal error.";
      results.push(createErrorResult(question, safeMessage));
    }
  }

  return results;
}

/**
 * Computes the overall grading summary from EvaluationResult[].
 * Percentage is computed from total possible marks, never from the
 * count of answered questions (Phase 6 section 15).
 */
function summarizeGrading(questions, mappings, results, unmatchedAnswers) {
  const answered = mappings.filter((m) => m.status === "matched").length;
  const unanswered = mappings.filter((m) => m.status === "unanswered").length;
  const evaluationErrors = results.filter((r) => r.status === "error").length;

  let totalMarks = 0;
  let marksAwarded = 0;
  let hasAnyMarksScale = false;

  for (const r of results) {
    if (typeof r.marksPossible === "number") {
      totalMarks += r.marksPossible;
      hasAnyMarksScale = true;
      if (typeof r.marksAwarded === "number") {
        marksAwarded += r.marksAwarded;
      }
    }
  }

  const percentage = hasAnyMarksScale && totalMarks > 0 ? Math.round((marksAwarded / totalMarks) * 100) : null;

  return {
    totalQuestions: questions.length,
    answered,
    unanswered,
    evaluationErrors,
    totalMarks: hasAnyMarksScale ? totalMarks : null,
    marksAwarded: hasAnyMarksScale ? marksAwarded : null,
    percentage,
    unmatchedAnswers: unmatchedAnswers.length,
  };
}

module.exports = { evaluateAssessment, summarizeGrading, combineAnswerText };
