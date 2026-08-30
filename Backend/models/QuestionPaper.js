const mongoose = require("mongoose");

/**
 * Question sub-schema.
 *
 * A "question" here also represents a labelled sub-part of a question
 * (e.g. 11(a), 11(b), 12(i), 12(ii)). Sub-parts are stored as fully
 * independent Question objects, not nested inside a parent question,
 * because the assignment requires them to be treated (extracted,
 * matched, graded) as separate questions.
 *
 * NOTE: This model is created for future/optional persistence only.
 * The Phase 1 extraction route does NOT currently save to MongoDB
 * (see routes/QuestionPaperRoute.js) — the assignment does not require
 * a database, so persistence is intentionally not forced here.
 */
const QuestionSchema = new mongoose.Schema(
  {
    // Stable identifier derived from number+subLabel, e.g. "q_11a", "q_1"
    id: { type: String, required: true },

    // Original printed root number as a string (keeps "1", "2", "11", "12" etc.
    // as printed — never coerced to a Number, since papers can use
    // non-numeric schemes too, e.g. roman numerals for the root number).
    number: { type: String, required: true },

    // Sub-part label if the question is a labelled sub-part, e.g. "a", "b", "i", "ii".
    // null when the question has no sub-part.
    subLabel: { type: String, default: null },

    // Human-readable original label exactly as it would appear printed,
    // e.g. "1", "11(a)", "12(ii)".
    displayLabel: { type: String, required: true },

    // Extracted question text.
    text: { type: String, required: true },

    // Deterministic printed order across the WHOLE paper (1-indexed),
    // assigned server-side after sorting by page then visual order.
    // This is the canonical ordering — never rely on raw array position.
    order: { type: Number, required: true },

    // Page number (1-indexed) of the question paper where this question
    // was detected.
    page: { type: Number, required: true },

    // Marks for this question/sub-part if visibly printed and confidently
    // detected. null when not detected — never invented/defaulted.
    marksPossible: { type: Number, default: null },

    // Extraction confidence (0-1) reported by the extraction step.
    // Optional metadata, not part of the assignment's minimum required
    // shape, but useful for future review/QA tooling.
    confidence: { type: Number, default: null },
  },
  { _id: false }
);

/**
 * QuestionPaper document: one extraction run over one uploaded
 * question-paper file, holding the ordered list of extracted questions.
 */
const QuestionPaperSchema = new mongoose.Schema(
  {
    originalFileName: { type: String },
    mimeType: { type: String },
    pageCount: { type: Number },
    questions: { type: [QuestionSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("QuestionPaper", QuestionPaperSchema);
