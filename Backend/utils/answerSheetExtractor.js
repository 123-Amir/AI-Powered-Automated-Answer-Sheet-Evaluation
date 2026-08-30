const { GoogleGenerativeAI } = require("@google/generative-ai");
const { imageSize } = require("image-size");
require("dotenv").config();

const { SUPPORTED_MIME_TYPES } = require("./questionExtractor");
const { renderPdfToImages } = require("./pdfPageRenderer");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API);

class AnswerExtractionError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "AnswerExtractionError";
    this.statusCode = statusCode;
  }
}

function fileToGenerativePart(buffer, mimeType) {
  const normalizedMimeType = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  return {
    inlineData: { data: buffer.toString("base64"), mimeType: normalizedMimeType },
  };
}

/**
 * Dedicated handwritten-answer extraction prompt. Deliberately NOT the
 * old "Answer 1:" / "Answer 2:" regex format used in geminiExtractor.js
 * — this returns structured JSON with per-answer bounding boxes.
 *
 * "continuesFromTopOfPage" lets Gemini flag that the FIRST answer block
 * on this page looks like it's a continuation of unfinished writing
 * rather than a new answer (e.g. no visible label, picks up mid-sentence).
 * We only use this signal for the first block of a page — see
 * normalizeAnswerBlocks() — to keep the continuation-linking conservative.
 */
const ANSWER_EXTRACTION_PROMPT = `You are extracting handwritten student answers from ONE page of an answer sheet.

Carefully inspect the entire page visually.

Identify each distinct handwritten answer written by the student. A page may
contain zero, one, or multiple separate answers, possibly out of numeric
order (e.g. the student may write question 3 before question 1).

Do NOT extract:
- printed page numbers, headers, footers, or watermarks
- margins or ruled lines with no content
- teacher annotations, ticks, crossed-out marks, or grading marks
- blank space

Rules for labels:
- "detectedLabel" is the question number/label the STUDENT wrote next to
  their answer, exactly as written (e.g. "1", "2", "11(a)", "11(b)", "12(i)").
- If the student did not write any visible label for an answer, return null
  for detectedLabel — do not guess or invent one.

Rules for text:
- "text" is the answer content, transcribed as accurately as possible.
- Do not translate, summarize, or correct spelling/grammar.
- Do not invent text that isn't actually on the page.

Rules for bounding boxes:
- "bbox" is the rectangular region containing ONLY that answer's handwriting,
  as a fraction of the full page (0 to 1), where:
    x = left edge / page width
    y = top edge / page height
    width = box width / page width
    height = box height / page height
- Be as visually precise as possible. If you cannot confidently locate the
  region, return null for bbox rather than guessing.

Rules for confidence:
- "confidence" (0 to 1): how confident you are in the label, text, AND bbox
  together being accurate.

Rules for continuation:
- "continuesFromTopOfPage": true only if THIS is the first answer on the
  page AND it visually appears to be a continuation of writing from a
  previous page (e.g. starts mid-sentence, no label, follows directly from
  the top margin). Otherwise false.

Return ONLY valid JSON, no markdown fences, no commentary, in exactly this
shape:

{
  "answers": [
    {
      "detectedLabel": "11(a)",
      "text": "...",
      "bbox": { "x": 0.12, "y": 0.34, "width": 0.76, "height": 0.18 },
      "confidence": 0.91,
      "continuesFromTopOfPage": false
    }
  ]
}

If there are no handwritten answers on this page, return {"answers": []}.`;

function stripCodeFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function parseGeminiResponse(rawText) {
  const cleaned = stripCodeFences(rawText || "");
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new AnswerExtractionError(
      "Gemini did not return valid JSON for answer extraction.",
      502
    );
  }
  return Array.isArray(parsed?.answers) ? parsed.answers : [];
}

/**
 * STAGE 1: extractAnswerBlocksFromPage
 * Sends one rendered page image to Gemini Vision and returns the raw,
 * unvalidated answer objects for that page. No normalization/validation
 * happens here — kept separate so a future/better bbox detector can
 * replace just this stage without touching the rest of the pipeline.
 */
async function extractAnswerBlocksFromPage(pageBuffer, mimeType, pageNumber) {
  if (!process.env.GEMINI_API) {
    throw new AnswerExtractionError("Server is missing GEMINI_API configuration.", 500);
  }

  const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  });
  const imagePart = fileToGenerativePart(pageBuffer, mimeType);

  let result;
  try {
    result = await model.generateContent([ANSWER_EXTRACTION_PROMPT, imagePart]);
  } catch (err) {
    throw new AnswerExtractionError(
      `Gemini request failed on page ${pageNumber}: ${err.message || "unknown error"}`,
      502
    );
  }

  const rawText = result?.response?.text ? result.response.text() : "";
  return parseGeminiResponse(rawText);
}

/**
 * STAGE 2: validateBoundingBoxes
 * Clamps/rejects bbox values. Never invents coordinates — an invalid or
 * missing bbox becomes `null`, and confidence is reduced (not zeroed,
 * since the label/text may still be perfectly correct) to reflect that
 * the region is not reliably known.
 */
function validateBoundingBoxes(answerBlocks) {
  let failureCount = 0;

  const validated = answerBlocks.map((block) => {
    const raw = block.boundingBox;

    const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);

    const hasAllFields =
      raw && isFiniteNum(raw.x) && isFiniteNum(raw.y) && isFiniteNum(raw.width) && isFiniteNum(raw.height);

    if (!hasAllFields) {
      if (raw) failureCount += 1; // a bbox was present but malformed
      return {
        ...block,
        boundingBox: null,
        confidence: block.confidence !== null ? Number((block.confidence * 0.5).toFixed(3)) : null,
      };
    }

    // Clamp origin into [0,1] first, then clamp extent so the box never
    // runs past the page edge, rather than silently accepting a box
    // that claims to extend beyond the page.
    const x = Math.min(Math.max(raw.x, 0), 1);
    const y = Math.min(Math.max(raw.y, 0), 1);
    const width = Math.min(Math.max(raw.width, 0), 1 - x);
    const height = Math.min(Math.max(raw.height, 0), 1 - y);

    if (width <= 0 || height <= 0) {
      failureCount += 1;
      return {
        ...block,
        boundingBox: null,
        confidence: block.confidence !== null ? Number((block.confidence * 0.5).toFixed(3)) : null,
      };
    }

    const wasClamped =
      x !== raw.x || y !== raw.y || width !== raw.width || height !== raw.height;

    return {
      ...block,
      boundingBox: { x, y, width, height },
      // Clamping means Gemini's original box was out of range; treat as
      // a (milder) validation concern too, without discarding the box.
      confidence:
        wasClamped && block.confidence !== null
          ? Number((block.confidence * 0.9).toFixed(3))
          : block.confidence,
    };
  });

  if (failureCount > 0) {
    console.log(`⚠️ [answerSheetExtractor] ${failureCount} bounding box(es) failed validation and were set to null`);
  }

  return validated;
}

/**
 * STAGE (id/shape normalization, between extract and validate):
 * Converts raw Gemini answer objects for ONE page into the canonical
 * AnswerBlock shape (still with unvalidated boundingBox — see
 * validateBoundingBoxes for that). Assigns sequential ids and wires up
 * conservative cross-page continuation links.
 *
 * @param {Array} rawAnswers - raw objects from extractAnswerBlocksFromPage
 * @param {number} pageNumber
 * @param {number|null} pageWidthPx
 * @param {number|null} pageHeightPx
 * @param {number} idStartIndex - next global id number to assign (1-indexed)
 * @param {object|null} lastBlockOfPreviousPage - mutable reference to the
 *   previous page's last pushed block, so we can set continuedBy on it
 * @returns {{ blocks: Array, nextIdIndex: number }}
 */
function normalizeAnswerBlocks(
  rawAnswers,
  pageNumber,
  pageWidthPx,
  pageHeightPx,
  idStartIndex,
  lastBlockOfPreviousPage
) {
  const blocks = [];
  let idIndex = idStartIndex;

  rawAnswers.forEach((raw, indexOnPage) => {
    const id = `ab_${String(idIndex).padStart(3, "0")}`;
    idIndex += 1;

    const detectedLabel =
      raw?.detectedLabel === undefined || raw?.detectedLabel === null || raw.detectedLabel === ""
        ? null
        : String(raw.detectedLabel).trim();

    const text = typeof raw?.text === "string" ? raw.text.trim() : "";

    const confidenceRaw = Number(raw?.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : null;

    // Only the FIRST block on a page is eligible to be a continuation of
    // the previous page — deliberately conservative (see Phase 2 spec:
    // "a false merge is worse than keeping two blocks separate").
    const isFirstOnPage = indexOnPage === 0;
    const claimsContinuation = raw?.continuesFromTopOfPage === true;

    let continuationOf = null;
    if (isFirstOnPage && claimsContinuation && lastBlockOfPreviousPage) {
      continuationOf = lastBlockOfPreviousPage.id;
    }

    blocks.push({
      id,
      detectedLabel,
      text,
      page: pageNumber,
      // boundingBox kept as the RAW (unvalidated) object here; see
      // validateBoundingBoxes(), which runs after this stage.
      boundingBox:
        raw?.bbox && typeof raw.bbox === "object"
          ? {
              x: Number(raw.bbox.x),
              y: Number(raw.bbox.y),
              width: Number(raw.bbox.width),
              height: Number(raw.bbox.height),
            }
          : null,
      pageWidthPx: pageWidthPx ?? null,
      pageHeightPx: pageHeightPx ?? null,
      confidence,
      spansMultiplePages: continuationOf !== null,
      continuationOf,
      continuedBy: null, // set below on the linked prior block, not on itself
    });
  });

  if (blocks.length > 0 && blocks[0].continuationOf && lastBlockOfPreviousPage) {
    lastBlockOfPreviousPage.continuedBy = blocks[0].id;
    lastBlockOfPreviousPage.spansMultiplePages = true;
  }

  return { blocks, nextIdIndex: idIndex };
}

/**
 * Reads pixel dimensions from a plain image buffer (PNG/JPEG) using the
 * `image-size` package (already a transitive dependency of pptxgenjs;
 * declared directly here since we now rely on it explicitly). Returns
 * null instead of throwing if dimensions can't be determined — pixel
 * dimensions are supplementary metadata; normalized bbox coordinates
 * remain valid/usable either way.
 */
function getImageDimensions(buffer) {
  try {
    const { width, height } = imageSize(buffer);
    return { widthPx: width, heightPx: height };
  } catch (err) {
    console.log("⚠️ [answerSheetExtractor] Could not determine image dimensions:", err.message);
    return { widthPx: null, heightPx: null };
  }
}

/**
 * Top-level entry point: extracts AnswerBlock[] from an uploaded answer
 * sheet (single image = page 1, or a multi-page PDF).
 *
 * Mapping to Question[] is explicitly NOT done here — see Phase 3.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{ pages: Array, answers: Array }>}
 */
/**
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {(info:{pageNumber:number, totalPages:number}) => void} [onProgress]
 *   Optional callback invoked after each page finishes extraction, so
 *   callers (e.g. the Phase 4 processing job) can report real
 *   page-level progress instead of a single opaque "extracting" step.
 *   Backward-compatible: existing callers that omit this argument are
 *   unaffected (see routes/AnswerSheetRoute.js).
 */
async function extractAnswersFromDocument(buffer, mimeType, onProgress) {
  if (!buffer || buffer.length === 0) {
    throw new AnswerExtractionError("Invalid or empty file received.", 400);
  }
  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
    throw new AnswerExtractionError(
      `Unsupported file type "${mimeType}". Supported types: ${SUPPORTED_MIME_TYPES.join(", ")}`,
      400
    );
  }

  const isPdf = mimeType === "application/pdf";

  /** @type {Array<{pageNumber:number, buffer:Buffer, widthPx:number|null, heightPx:number|null}>} */
  let renderedPages;

  if (isPdf) {
    try {
      renderedPages = await renderPdfToImages(buffer);
    } catch (err) {
      throw new AnswerExtractionError(`PDF rendering failed: ${err.message}`, 500);
    }
    if (renderedPages.length === 0) {
      throw new AnswerExtractionError("The uploaded PDF has no pages.", 422);
    }
  } else {
    // Image upload = page 1, no rendering needed.
    const dims = getImageDimensions(buffer);
    renderedPages = [{ pageNumber: 1, buffer, widthPx: dims.widthPx, heightPx: dims.heightPx }];
  }

  console.log(`📄 [answerSheetExtractor] Processing ${renderedPages.length} page(s)`);

  const allAnswers = [];
  const pagesMeta = [];
  let nextIdIndex = 1;
  let lastBlockOfPreviousPage = null;

  // Sequential processing: one page's Gemini call + buffer at a time,
  // per the Phase 2 memory requirement.
  for (const renderedPage of renderedPages) {
    const { pageNumber, buffer: pageBuffer, widthPx, heightPx } = renderedPage;
    console.log(`📄 [answerSheetExtractor] Page ${pageNumber}/${renderedPages.length}: extracting answers`);

    // PDF-rendered pages are always PNG (see pdfPageRenderer.js); plain
    // image uploads keep their original mimeType.
    const pageMimeType = isPdf ? "image/png" : mimeType;

    const rawAnswers = await extractAnswerBlocksFromPage(pageBuffer, pageMimeType, pageNumber);
    console.log(`📄 [answerSheetExtractor] Page ${pageNumber}: ${rawAnswers.length} answer block(s) detected`);

    const { blocks, nextIdIndex: updatedIdIndex } = normalizeAnswerBlocks(
      rawAnswers,
      pageNumber,
      widthPx,
      heightPx,
      nextIdIndex,
      lastBlockOfPreviousPage
    );
    nextIdIndex = updatedIdIndex;

    allAnswers.push(...blocks);
    // Buffer/mimeType are kept here so Phase 4/5 callers (the
    // assessment pipeline) can persist page images for later serving
    // to the frontend. Callers that only need metadata (e.g. Phase 2's
    // own /api/answer-sheet route) must strip these before sending a
    // JSON response — a raw Buffer serializes as a huge byte array.
    pagesMeta.push({
      pageNumber,
      widthPx: widthPx ?? null,
      heightPx: heightPx ?? null,
      buffer: pageBuffer,
      mimeType: pageMimeType,
    });

    lastBlockOfPreviousPage = blocks.length > 0 ? blocks[blocks.length - 1] : null;

    // Release the page's raster buffer reference now that we're done
    // with it (relevant mainly for PDF-rendered pages).
    renderedPage.buffer = null;

    if (typeof onProgress === "function") {
      onProgress({ pageNumber, totalPages: renderedPages.length });
    }
  }

  // STAGE 3: validate/clamp all bounding boxes in one place, after all
  // pages are processed (continuation linking above needs block ids
  // established first, so this intentionally runs last).
  const validatedAnswers = validateBoundingBoxes(allAnswers);

  return { pages: pagesMeta, answers: validatedAnswers };
}

module.exports = {
  extractAnswersFromDocument,
  extractAnswerBlocksFromPage,
  normalizeAnswerBlocks,
  validateBoundingBoxes,
  AnswerExtractionError,
  SUPPORTED_MIME_TYPES,
};
