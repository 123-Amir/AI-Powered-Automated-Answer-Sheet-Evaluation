/**
 * Semantic fallback matching — used ONLY when an AnswerBlock has no
 * usable label (null, or unparseable even by the fuzzy label tier) and
 * there are still unanswered candidate questions left. Never called
 * for every answer — the mapper only invokes this once per genuinely
 * unlabeled/unmatched answer unit (see answerMapper.js).
 *
 * Two implementations are provided:
 *   1. A Gemini-backed matcher (used when GEMINI_API is configured) —
 *      the approach described in the Phase 3 spec: ask the model to
 *      pick the best candidate question id + a confidence score.
 *   2. A dependency-free lexical keyword-overlap heuristic, used as a
 *      fallback whenever Gemini is unavailable OR the call fails for
 *      any reason (network, quota, malformed response). This keeps
 *      mapping usable (and testable offline) even without an API key.
 *
 * Callers must apply their own conservative acceptance threshold on
 * the returned confidence (see SEMANTIC_MATCH_THRESHOLD in
 * answerMapper.js) — this module never claims a match is "accepted",
 * it only reports its best guess + how confident it is.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const STOPWORDS = new Set([
  "the", "a", "an", "is", "of", "to", "and", "in", "on", "for", "with",
  "that", "this", "are", "was", "be", "as", "it", "by", "at", "or", "if",
  "from", "which", "how", "what", "why", "when", "does", "do", "you",
  "your", "explain", "describe", "define", "write", "state", "list",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Dependency-free keyword-overlap heuristic. Not a real semantic
 * matcher — a conservative stand-in used offline / when Gemini is
 * unavailable. Longer, more distinctive words count more, since
 * overlapping short/common words are weak evidence of topical match.
 */
function lexicalSemanticMatch(answerText, candidateQuestions) {
  const answerTokens = new Set(tokenize(answerText));
  if (answerTokens.size === 0) return null;

  let best = null;

  for (const question of candidateQuestions) {
    const questionTokens = new Set(tokenize(question.text));
    if (questionTokens.size === 0) continue;

    let overlapWeight = 0;
    let questionWeight = 0;
    for (const token of questionTokens) {
      const weight = token.length; // longer/rarer words count more
      questionWeight += weight;
      if (answerTokens.has(token)) overlapWeight += weight;
    }

    if (questionWeight === 0) continue;
    const rawScore = overlapWeight / questionWeight; // 0..1

    if (!best || rawScore > best.rawScore) {
      best = { questionId: question.id, rawScore };
    }
  }

  if (!best || best.rawScore <= 0) return null;

  // Map raw overlap score into the spec's suggested semantic
  // confidence band (0.70-0.89), never claiming higher certainty than
  // a true semantic/LLM match tier would.
  const confidence = Math.min(0.89, 0.7 + best.rawScore * 0.19);
  return { questionId: best.questionId, confidence: Number(confidence.toFixed(3)) };
}

const SEMANTIC_PROMPT_HEADER = `You are matching ONE handwritten student answer (with no usable question label) to the single most likely question it is answering, from a list of candidate questions that do not yet have a matched answer.

Only pick a question if the answer content plausibly addresses it. If none of the candidates plausibly match, or you are unsure, return null for questionId.

Return ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{ "questionId": "q_4", "confidence": 0.84 }
or, if no candidate plausibly matches:
{ "questionId": null, "confidence": 0 }

"confidence" must be between 0 and 1, reflecting how sure you are.`;

function stripCodeFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

async function geminiSemanticMatch(answerText, candidateQuestions) {
  if (!process.env.GEMINI_API) return null;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const candidateList = candidateQuestions
    .map((q) => `- id: "${q.id}", text: "${(q.text || "").slice(0, 300).replace(/"/g, "'")}"`)
    .join("\n");

  const prompt = `${SEMANTIC_PROMPT_HEADER}

Candidate questions:
${candidateList}

Student answer text:
"${String(answerText || "").slice(0, 1000).replace(/"/g, "'")}"`;

  try {
    const result = await model.generateContent(prompt);
    const rawText = result?.response?.text ? result.response.text() : "";
    const parsed = JSON.parse(stripCodeFences(rawText));

    if (!parsed || parsed.questionId === null || parsed.questionId === undefined) return null;

    const confidenceRaw = Number(parsed.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0;

    // Guard against the model inventing an id that isn't actually one
    // of the candidates we offered it.
    const isValidCandidate = candidateQuestions.some((q) => q.id === parsed.questionId);
    if (!isValidCandidate) return null;

    return { questionId: parsed.questionId, confidence };
  } catch (err) {
    console.log("⚠️ [semanticMatcher] Gemini semantic match failed, falling back to lexical heuristic:", err.message);
    return null;
  }
}

/**
 * @param {string} answerText
 * @param {Array<{id:string, text:string}>} candidateQuestions - only
 *   questions that are still unanswered/unclaimed should be passed in
 * @returns {Promise<{questionId:string, confidence:number} | null>}
 */
async function semanticMatchQuestion(answerText, candidateQuestions) {
  if (!candidateQuestions || candidateQuestions.length === 0) return null;

  const geminiResult = await geminiSemanticMatch(answerText, candidateQuestions);
  if (geminiResult) return geminiResult;

  // No GEMINI_API configured, or the call failed/returned nothing usable.
  return lexicalSemanticMatch(answerText, candidateQuestions);
}

module.exports = { semanticMatchQuestion, lexicalSemanticMatch };
