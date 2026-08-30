const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API);

// Files this utility knows how to handle. Kept in one place so the
// route can reuse the exact same whitelist for validation.
const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg", // not a real IANA type, but some clients/browsers send it
  "image/png",
];

/**
 * Small typed error so the route layer can map failures to sensible
 * HTTP status codes without string-matching error messages.
 */
class QuestionExtractionError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "QuestionExtractionError";
    this.statusCode = statusCode;
  }
}

/**
 * Builds the Gemini "part" for the uploaded document/image.
 *
 * Design decision (documented for the final report): Gemini 1.5 Pro
 * accepts PDF files directly as inline document data and reads them
 * natively (including page structure), so there is no need to add a
 * PDF rendering/rasterization dependency (e.g. pdfjs-dist + canvas)
 * for THIS phase. This keeps the implementation dependency-free and
 * avoids native-binary packages that are risky on Render-style
 * deployments. See questionExtractor.js header comment for caveats.
 */
function fileToGenerativePart(buffer, mimeType) {
  // Normalize the non-standard "image/jpg" some clients send, since
  // Gemini expects the standard "image/jpeg" MIME type.
  const normalizedMimeType = mimeType === "image/jpg" ? "image/jpeg" : mimeType;

  return {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType: normalizedMimeType,
    },
  };
}

/**
 * Dedicated question-extraction prompt.
 *
 * Instructs Gemini to:
 *  - read the document visually (image or PDF)
 *  - extract ONLY actual questions (not headings/instructions/marks legends)
 *  - preserve the exact printed number
 *  - split labelled sub-parts (11(a), 12(i)) into independent entries
 *  - report a page number and a visual order per question
 *  - report marks if visible, else null
 *  - report a confidence score
 *  - return JSON only, never invent questions
 */
const QUESTION_EXTRACTION_PROMPT = `You are extracting questions from a school/college question paper.

The input may be a single image (one page) or a multi-page PDF document.

Carefully read every page and extract ONLY the actual exam questions.
Do NOT extract:
- section headings (e.g. "Section A", "Part II")
- general instructions (e.g. "Answer any five questions")
- marks legends/tables that are not themselves a question
- page numbers, headers, footers, or watermarks

Rules for numbering:
- Preserve the EXACT printed question number, as a string (e.g. "1", "2", "11").
- If a question has a labelled sub-part (e.g. 11(a), 11(b), 12(i), 12(ii)),
  treat EACH sub-part as its OWN independent question entry — do not merge
  sub-parts into one entry, and do not merge a parent question with its
  sub-parts into one entry.
- "number" is the root/parent number only (e.g. "11" for both 11(a) and 11(b)).
- "subLabel" is the sub-part label only (e.g. "a", "b", "i", "ii"), or null
  if the question has no sub-part.
- "displayLabel" is the exact printed label as a human would read it
  (e.g. "1", "11(a)", "12(ii)").

Rules for ordering:
- "page" is the 1-indexed page number on which the question appears.
- "visualOrder" is the order in which the question appears when reading
  that page top-to-bottom, left-to-right (1-indexed, restarting on each page).

Rules for text:
- "text" should preserve the question's wording as accurately as possible.
- Do not translate, summarize, or paraphrase.

Rules for marks:
- "marksPossible" is the marks for that specific question/sub-part if visibly
  printed and you are confident about it (e.g. "[5 marks]", "(10)").
- If marks are not visible or you are not confident, return null. Never guess.

Rules for confidence:
- "confidence" is your confidence in this extraction being an accurate,
  correctly-numbered question, from 0 (low) to 1 (high).

Do not invent questions that are not present in the document.
If you are uncertain whether something is a question, prefer excluding it
over inventing content, but if you do include it, give it a lower confidence.

Return ONLY valid JSON, no markdown code fences, no commentary, in exactly
this shape:

{
  "questions": [
    {
      "number": "11",
      "subLabel": "a",
      "displayLabel": "11(a)",
      "text": "...",
      "page": 1,
      "visualOrder": 3,
      "marksPossible": 5,
      "confidence": 0.94
    }
  ]
}`;

/**
 * Strips markdown code fences (```json ... ```) that Gemini sometimes
 * wraps JSON responses in, despite being told not to.
 */
function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/**
 * Parses and loosely validates the raw Gemini response text into an
 * array of raw question objects. Never throws for "shape" problems —
 * malformed/missing fields are tolerated here and normalized later;
 * this function only throws if the response isn't parseable JSON at all.
 */
function parseGeminiResponse(rawText) {
  const cleaned = stripCodeFences(rawText || "");

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new QuestionExtractionError(
      "Gemini did not return valid JSON for question extraction.",
      502
    );
  }

  const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  return rawQuestions;
}

/**
 * Normalizes a single raw Gemini question object into the canonical
 * Question shape. Does NOT assign `id` or final `order` — those are
 * assigned after all pages have been merged and sorted.
 */
function normalizeRawQuestion(raw, fallbackPage) {
  const number = raw?.number !== undefined && raw?.number !== null
    ? String(raw.number).trim()
    : null;

  const subLabel =
    raw?.subLabel === undefined || raw?.subLabel === null || raw.subLabel === ""
      ? null
      : String(raw.subLabel).trim();

  const text = typeof raw?.text === "string" ? raw.text.trim() : "";

  const displayLabel =
    typeof raw?.displayLabel === "string" && raw.displayLabel.trim()
      ? raw.displayLabel.trim()
      : subLabel
      ? `${number}(${subLabel})`
      : number || "";

  // Number(null) === 0 (finite!) and Number(undefined) === NaN, so both must
  // be checked explicitly before coercion — otherwise a genuinely-absent
  // value silently becomes 0 instead of staying null/falling back.
  const hasValue = (v) => v !== null && v !== undefined && v !== "";

  const page = hasValue(raw?.page) && Number.isFinite(Number(raw.page))
    ? Number(raw.page)
    : fallbackPage;

  const visualOrder = hasValue(raw?.visualOrder) && Number.isFinite(Number(raw.visualOrder))
    ? Number(raw.visualOrder)
    : null;

  const marksPossible = hasValue(raw?.marksPossible) && Number.isFinite(Number(raw.marksPossible))
    ? Number(raw.marksPossible)
    : null;

  const confidenceRaw = Number(raw?.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, confidenceRaw))
    : null;

  return {
    number,
    subLabel,
    displayLabel,
    text,
    page,
    visualOrder,
    marksPossible,
    confidence,
  };
}

/**
 * Assigns stable, unique ids ("q_11a", "q_1", ...) and a final
 * deterministic `order` (1-indexed) based on page then visualOrder.
 * Falls back to merge-stable original position when visualOrder is
 * missing or tied, since Gemini's ordering is not guaranteed to be
 * perfect (per Phase 1 instructions, array position is never trusted
 * as identity, only as a last-resort tie-breaker for ordering).
 */
function finalizeQuestionOrder(normalizedQuestions) {
  const withIndex = normalizedQuestions.map((q, index) => ({ ...q, __originalIndex: index }));

  withIndex.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;

    const aOrder = a.visualOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.visualOrder ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;

    return a.__originalIndex - b.__originalIndex;
  });

  const usedIds = new Set();

  return withIndex.map((q, idx) => {
    const baseId = `q_${(q.number || "unknown").replace(/\s+/g, "")}${q.subLabel || ""}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}_${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    return {
      id,
      number: q.number,
      subLabel: q.subLabel,
      displayLabel: q.displayLabel,
      text: q.text,
      order: idx + 1,
      page: q.page,
      marksPossible: q.marksPossible,
      confidence: q.confidence,
    };
  });
}

/**
 * Extracts questions from a question-paper document (single image or
 * multi-page PDF) using Gemini Vision.
 *
 * @param {Buffer} buffer - raw file bytes
 * @param {string} mimeType - one of SUPPORTED_MIME_TYPES
 * @returns {Promise<Array>} normalized, ordered Question objects
 */
const extractQuestionsFromDocument = async (buffer, mimeType) => {
  if (!buffer || buffer.length === 0) {
    throw new QuestionExtractionError("Invalid or empty file received.", 400);
  }

  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
    throw new QuestionExtractionError(
      `Unsupported file type "${mimeType}". Supported types: ${SUPPORTED_MIME_TYPES.join(", ")}`,
      400
    );
  }

  if (!process.env.GEMINI_API) {
    throw new QuestionExtractionError(
      "Server is missing GEMINI_API configuration.",
      500
    );
  }

  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
  const documentPart = fileToGenerativePart(buffer, mimeType);

  let result;
  try {
    // A single call handles the whole document. For PDFs, Gemini 1.5 Pro
    // reads every page natively and we ask it to report a "page" number
    // per question, which satisfies the "process every page / preserve
    // page numbers" requirement without a separate rasterization step.
    result = await model.generateContent([QUESTION_EXTRACTION_PROMPT, documentPart]);
  } catch (err) {
    throw new QuestionExtractionError(
      `Gemini request failed: ${err.message || "unknown error"}`,
      502
    );
  }

  const rawText = result?.response?.text ? result.response.text() : "";
  const rawQuestions = parseGeminiResponse(rawText);

  const normalized = rawQuestions
    .map((raw) => normalizeRawQuestion(raw, 1))
    // Drop entries with no usable number AND no text — these are almost
    // certainly extraction noise, not real questions.
    // A question with no parseable number can never satisfy "preserve
    // original numbering" (its displayLabel would be empty), and is far
    // more likely to be misclassified non-question content (an
    // instruction line, a stray fragment) than a real numbered question
    // — per the prompt's own rule, "do not invent questions" extends to
    // not KEEPING ones we can't actually number. Drop these rather than
    // surface a broken, unlabeled entry (fixed in the pre-submission audit).
    .filter((q) => q.number);

  const finalized = finalizeQuestionOrder(normalized);

  return finalized;
};

module.exports = {
  extractQuestionsFromDocument,
  QuestionExtractionError,
  SUPPORTED_MIME_TYPES,
};
