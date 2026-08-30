/**
 * Evaluates ONE student answer against ONE question via Gemini.
 *
 * REUSE NOTE (see Phase 6 final report section A for full detail): the
 * existing evaluator (utils/geminiHelper.js's evaluateAnswers) batches
 * ALL questions into a single free-text prompt and regex-parses a
 * fixed "Score - X/5" format tied to a hardcoded 5-mark scale and a
 * "difficulty" concept that doesn't exist in the new Question model
 * (which carries a per-question marksPossible instead). That format
 * can't represent per-question marksPossible, structured strengths/
 * improvements, or a correctness taxonomy, so it isn't reused
 * mechanically — but the underlying pattern IS reused: same Gemini
 * client library, same "gemini-1.5-flash" model tier already
 * established in this project specifically for evaluation/grading
 * (as opposed to gemini-3.6-flash, which this project uses for vision
 * extraction). geminiHelper.js itself is left completely untouched —
 * the old /api/evaluations flow keeps working exactly as before.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API);

class EvaluationError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvaluationError";
  }
}

function stripCodeFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

/**
 * Builds the grading prompt. When marksPossible is known, the AI is
 * asked to award marks on that exact scale. When it's unknown, the AI
 * is explicitly told NOT to invent a maximum — it evaluates quality
 * only, and marksAwarded is omitted (see answerEvaluator's handling).
 */
function buildPrompt(questionText, studentAnswer, marksPossible) {
  const marksInstruction =
    marksPossible !== null && marksPossible !== undefined
      ? `Award "marksAwarded" as a number between 0 and ${marksPossible} (inclusive). Do not exceed ${marksPossible} and do not go below 0.`
      : `No marks scale is available for this question. Set "marksAwarded" to null — do NOT invent a maximum or award an arbitrary number.`;

  return `You are grading ONE student's handwritten answer against ONE exam question. The answer text was extracted from handwriting via OCR/vision, so it may contain minor transcription noise.

Question:
"${String(questionText || "").slice(0, 1500)}"

Student's answer:
"${String(studentAnswer || "").slice(0, 4000)}"

Evaluate strictly based on:
- correctness of the content
- relevance to the question
- completeness (are key concepts covered)
- factual accuracy
- quality of explanation

Rules you MUST follow:
- Evaluate ONLY against the question given above — do not grade on unrelated criteria.
- Do NOT penalize the answer for obvious OCR/handwriting transcription noise (odd spacing, a clearly misread character, etc.) — evaluate the understandable semantic content underneath.
- Do NOT invent facts, details, or wording that are not actually present in the answer.
- Do NOT award full marks without clear, sufficient evidence in the answer.
- Do NOT award zero marks merely because the wording differs from a "textbook" phrasing — an equivalent explanation in different words deserves appropriate credit.
- If the answer is blank, nonsensical, or entirely off-topic, treat it as incorrect, not partially correct.

${marksInstruction}

"correctness" must be exactly one of: "correct", "mostly_correct", "partially_correct", "incorrect".

Return ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "marksAwarded": 4,
  "correctness": "mostly_correct",
  "feedback": "One or two sentences explaining the score.",
  "strengths": ["Short point 1", "Short point 2"],
  "improvements": ["Short point 1"],
  "confidence": 0.91
}`;
}

/**
 * @param {{questionText:string, studentAnswer:string, marksPossible:number|null}} input
 * @returns {Promise<{marksAwarded:number|null, correctness:string, feedback:string, strengths:string[], improvements:string[], confidence:number|null}>}
 */
async function evaluateAnswer({ questionText, studentAnswer, marksPossible }) {
  if (!process.env.GEMINI_API) {
    throw new EvaluationError("Server is missing GEMINI_API configuration.");
  }

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const prompt = buildPrompt(questionText, studentAnswer, marksPossible);

  let result;
  try {
    result = await model.generateContent(prompt);
  } catch (err) {
    throw new EvaluationError(`Gemini request failed: ${err.message || "unknown error"}`);
  }

  const rawText = result?.response?.text ? result.response.text() : "";
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(rawText));
  } catch (err) {
    throw new EvaluationError("Gemini did not return valid JSON for answer evaluation.");
  }

  const validCorrectness = ["correct", "mostly_correct", "partially_correct", "incorrect"];
  const correctness = validCorrectness.includes(parsed?.correctness) ? parsed.correctness : null;
  if (!correctness) {
    throw new EvaluationError("Gemini returned an unrecognized correctness value.");
  }

  // Clamp marksAwarded into [0, marksPossible] — never trust the model
  // to respect the scale on its own. If no scale exists, marks stay null
  // regardless of anything the model returned (never fabricate a max).
  let marksAwarded = null;
  if (marksPossible !== null && marksPossible !== undefined) {
    const raw = Number(parsed?.marksAwarded);
    marksAwarded = Number.isFinite(raw) ? Math.min(marksPossible, Math.max(0, raw)) : 0;
  }

  const feedback = typeof parsed?.feedback === "string" ? parsed.feedback.trim() : "";
  const strengths = Array.isArray(parsed?.strengths)
    ? parsed.strengths.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : [];
  const improvements = Array.isArray(parsed?.improvements)
    ? parsed.improvements.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : [];

  const confidenceRaw = Number(parsed?.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : null;

  return { marksAwarded, correctness, feedback, strengths, improvements, confidence };
}

module.exports = { evaluateAnswer, EvaluationError };
