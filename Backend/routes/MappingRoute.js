const express = require("express");
const { mapAnswersToQuestions } = require("../utils/answerMapper");

const router = express.Router();

/**
 * Minimal shape validation — never trusts client-provided structures.
 * Returns an error string, or null if the input looks usable.
 */
function validateInput(body) {
  if (!body || typeof body !== "object") return "Request body must be a JSON object.";

  const { questions, answerBlocks } = body;

  if (!Array.isArray(questions)) return "\"questions\" must be an array.";
  if (!Array.isArray(answerBlocks)) return "\"answerBlocks\" must be an array.";

  for (const [i, q] of questions.entries()) {
    if (!q || typeof q !== "object") return `questions[${i}] must be an object.`;
    if (typeof q.id !== "string" || !q.id) return `questions[${i}].id is required.`;
    if (typeof q.displayLabel !== "string" || !q.displayLabel) {
      return `questions[${i}].displayLabel is required.`;
    }
  }

  for (const [i, a] of answerBlocks.entries()) {
    if (!a || typeof a !== "object") return `answerBlocks[${i}] must be an object.`;
    if (typeof a.id !== "string" || !a.id) return `answerBlocks[${i}].id is required.`;
  }

  const questionIds = new Set(questions.map((q) => q.id));
  if (questionIds.size !== questions.length) return "\"questions\" contains duplicate ids.";

  const answerIds = new Set(answerBlocks.map((a) => a.id));
  if (answerIds.size !== answerBlocks.length) return "\"answerBlocks\" contains duplicate ids.";

  // continuationOf/continuedBy must reference real block ids, if present,
  // so buildAnswerUnits() can't silently mis-chain on bad input.
  for (const [i, a] of answerBlocks.entries()) {
    if (a.continuationOf !== undefined && a.continuationOf !== null && !answerIds.has(a.continuationOf)) {
      return `answerBlocks[${i}].continuationOf references an unknown block id.`;
    }
    if (a.continuedBy !== undefined && a.continuedBy !== null && !answerIds.has(a.continuedBy)) {
      return `answerBlocks[${i}].continuedBy references an unknown block id.`;
    }
  }

  return null;
}

/**
 * POST /api/map-answers
 *
 * Body: { questions: Question[], answerBlocks: AnswerBlock[] }
 * (the outputs of Phase 1 and Phase 2, respectively — this route does
 * not extract anything itself, and does not persist anything).
 */
router.post("/", async (req, res) => {
  try {
    const validationError = validateInput(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const { questions, answerBlocks } = req.body;

    // Normalize optional fields the mapper relies on, so callers don't
    // have to send every field explicitly.
    const normalizedAnswerBlocks = answerBlocks.map((a) => ({
      id: a.id,
      detectedLabel: a.detectedLabel ?? null,
      text: a.text ?? "",
      continuationOf: a.continuationOf ?? null,
      continuedBy: a.continuedBy ?? null,
    }));

    const { mappings, unmatchedAnswers } = await mapAnswersToQuestions(questions, normalizedAnswerBlocks);

    return res.status(200).json({ success: true, mappings, unmatchedAnswers });
  } catch (error) {
    console.error("🚨 Answer mapping error:", error);
    return res.status(500).json({ success: false, error: error.message || "Internal Server Error" });
  }
});

module.exports = router;
