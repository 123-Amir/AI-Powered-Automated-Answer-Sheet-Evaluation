const { normalizeQuestionLabel, ocrCorrectLeadingNumber, rawNormalize } = require("./labelNormalizer");
const { semanticMatchQuestion } = require("./semanticMatcher");

// Confidence bands per Phase 3 spec section 13. Fixed constants (not
// scaled per-item) so results stay consistent and predictable.
const CONFIDENCE = {
  label_exact: 0.98,
  label_normalized: 0.95,
  label_fuzzy: 0.85,
  // semantic confidence comes directly from semanticMatcher, already
  // clamped into the 0.70-0.89 band there.
};

const SEMANTIC_MATCH_THRESHOLD = 0.75;

const RANK = { label_exact: 3, label_normalized: 2, label_fuzzy: 1, semantic: 0 };

/** Strips known leading/trailing "answer/ans/solution" noise words before a fuzzy re-parse. */
function stripAnswerNoiseWords(label) {
  if (!label) return label;
  let s = String(label).trim();
  s = s.replace(/^(answer\s*(to)?|ans\.?|solution|sol\.?)\s*[:\-]?\s*/i, "");
  s = s.replace(/\s*[:\-]?\s*(answer|ans\.?|solution|sol\.?)\s*$/i, "");
  s = s.replace(/[[\]]/g, "").trim();
  // Strip a stray trailing colon/dash left over after removing the
  // noise word (e.g. "Ans 11(a):" -> "11(a):" -> "11(a)").
  s = s.replace(/[:\-]+$/, "").trim();
  return s;
}

/**
 * Groups AnswerBlocks into "units": one per root block (continuationOf
 * === null), absorbing any blocks chained to it via continuedBy. This
 * is what lets a multi-page answer (section 12) be treated as a single
 * matchable thing while still preserving every individual block id.
 */
function buildAnswerUnits(answerBlocks) {
  const byId = new Map(answerBlocks.map((b) => [b.id, b]));
  const units = [];

  for (const block of answerBlocks) {
    if (block.continuationOf !== null && block.continuationOf !== undefined) continue; // not a root

    const chainIds = [block.id];
    let current = block;
    while (current.continuedBy && byId.has(current.continuedBy)) {
      current = byId.get(current.continuedBy);
      chainIds.push(current.id);
    }

    const chainBlocks = chainIds.map((id) => byId.get(id));
    units.push({
      rootId: block.id,
      blockIds: chainIds,
      detectedLabel: block.detectedLabel, // per Phase 2 design, the label lives on the root block
      text: chainBlocks.map((b) => b.text || "").join(" ").trim(),
    });
  }

  return units;
}

/** Builds a canonical-label -> question lookup and a raw-normalized-label -> question lookup. */
/**
 * Builds a canonical-label -> question lookup and a raw-normalized-label
 * -> question lookup.
 *
 * BUG FIX (pre-submission audit): if the extractor ever returns two
 * questions with the SAME displayLabel (a rare but real AI-extraction
 * anomaly — e.g. Gemini splitting one question into two near-duplicate
 * entries), a plain Map.set() here would let the second one silently
 * overwrite the first's index entry. That caused a genuine bug: a real
 * student answer for the first "1" would get matched to the SECOND
 * (unrelated) question object named "1" purely because it was inserted
 * later — while the first, actually-answered question incorrectly
 * showed as "unanswered". This is exactly the kind of index/insertion-
 * order-driven mis-mapping the whole matching pipeline is designed to
 * avoid.
 *
 * Fix: track how many questions map to each canonical/raw key. If more
 * than one does, the label is AMBIGUOUS and is deliberately excluded
 * from both indexes — so a same-labeled answer falls through to
 * "no match" (both questions end up correctly unmatched) rather than
 * being silently misattributed to the wrong one. This mirrors the
 * project's own established principle (Phase 3 spec, section 9): "a
 * false positive mapping is worse than an unanswered/unmatched status."
 */
function buildQuestionIndexes(questions) {
  const byCanonical = new Map();
  const byRaw = new Map();
  const canonicalCounts = new Map();
  const rawCounts = new Map();

  for (const q of questions) {
    const canonical = normalizeQuestionLabel(q.displayLabel);
    if (canonical) {
      canonicalCounts.set(canonical, (canonicalCounts.get(canonical) || 0) + 1);
      byCanonical.set(canonical, q);
    }

    const raw = rawNormalize(q.displayLabel);
    if (raw) {
      rawCounts.set(raw, (rawCounts.get(raw) || 0) + 1);
      byRaw.set(raw, q);
    }
  }

  for (const [key, count] of canonicalCounts) {
    if (count > 1) {
      console.log(`⚠️ [answerMapper] Ambiguous duplicate question label "${key}" (${count} questions) — excluded from label matching to avoid mis-attributing an answer.`);
      byCanonical.delete(key);
    }
  }
  for (const [key, count] of rawCounts) {
    if (count > 1) byRaw.delete(key);
  }

  return { byCanonical, byRaw };
}

/**
 * Attempts label-based matching for one answer unit, in strict tier
 * order. Returns { question, method, confidence } or null.
 */
function attemptLabelMatch(unit, indexes) {
  const label = unit.detectedLabel;
  if (!label) return null;

  // Tier 1: exact (whitespace/case-insensitive only — no delimiter normalization)
  const raw = rawNormalize(label);
  if (raw && indexes.byRaw.has(raw)) {
    return { question: indexes.byRaw.get(raw), method: "label_exact", confidence: CONFIDENCE.label_exact };
  }

  // Tier 2: normalized (delimiters/prefixes cleaned up)
  const canonical = normalizeQuestionLabel(label);
  if (canonical && indexes.byCanonical.has(canonical)) {
    return { question: indexes.byCanonical.get(canonical), method: "label_normalized", confidence: CONFIDENCE.label_normalized };
  }

  // Tier 3: conservative fuzzy — OCR leading-digit correction, and
  // stripping known noise words, each followed by a strict re-parse.
  // Never fuzzes the sub-label letters themselves (see labelNormalizer.js);
  // "11(a)" can never fuzzy-match "11(b)" or "12(a)".
  const ocrCorrected = ocrCorrectLeadingNumber(label);
  if (ocrCorrected) {
    const ocrCanonical = normalizeQuestionLabel(ocrCorrected);
    if (ocrCanonical && indexes.byCanonical.has(ocrCanonical)) {
      return { question: indexes.byCanonical.get(ocrCanonical), method: "label_fuzzy", confidence: CONFIDENCE.label_fuzzy };
    }
  }

  const noiseStripped = stripAnswerNoiseWords(label);
  if (noiseStripped && noiseStripped !== label) {
    const strippedCanonical = normalizeQuestionLabel(noiseStripped);
    if (strippedCanonical && indexes.byCanonical.has(strippedCanonical)) {
      return { question: indexes.byCanonical.get(strippedCanonical), method: "label_fuzzy", confidence: CONFIDENCE.label_fuzzy };
    }
  }

  return null;
}

/**
 * Maps extracted AnswerBlocks to extracted Questions.
 *
 * @param {Array} questions - Question[] from Phase 1
 * @param {Array} answerBlocks - AnswerBlock[] from Phase 2
 * @returns {Promise<{ mappings: Array, unmatchedAnswers: Array }>}
 */
async function mapAnswersToQuestions(questions, answerBlocks) {
  const indexes = buildQuestionIndexes(questions);
  const units = buildAnswerUnits(answerBlocks);

  // questionId -> { blockIds: string[], method, confidence }
  const matchedByQuestionId = new Map();
  // unit.rootId -> true once it has been successfully attached to some question
  const claimedUnitIds = new Set();
  // unit.rootId -> a lower-ranked match it lost out on, kept so we can
  // report a specific reason if it ends up fully unmatched
  const loseReasonByUnitId = new Map();

  function recordMatch(unit, question, method, confidence) {
    const existing = matchedByQuestionId.get(question.id);
    if (!existing) {
      matchedByQuestionId.set(question.id, { blockIds: [...unit.blockIds], method, confidence });
      claimedUnitIds.add(unit.rootId);
      return true;
    }

    // Section 14: deterministic conflict resolution instead of silent
    // overwrite. Same-tier collision on the SAME question = combine
    // (section 11's duplicate/rewritten-answer case). Higher tier wins
    // outright; lower tier is rejected (left for the caller to report).
    if (RANK[method] > RANK[existing.method]) {
      // The previously-winning unit is now displaced — surface it as
      // its own reason if nothing else claims it later.
      matchedByQuestionId.set(question.id, { blockIds: [...unit.blockIds], method, confidence });
      claimedUnitIds.add(unit.rootId);
      return true;
    }
    if (RANK[method] === RANK[existing.method]) {
      existing.blockIds.push(...unit.blockIds);
      claimedUnitIds.add(unit.rootId);
      return true;
    }

    loseReasonByUnitId.set(
      unit.rootId,
      `Label "${unit.detectedLabel}" matches question ${question.displayLabel}, but a higher-confidence answer was already matched to it.`
    );
    return false;
  }

  // Pass 1: label-based matching, tiered, for every unit with a detectedLabel.
  for (const unit of units) {
    if (!unit.detectedLabel) continue;
    const match = attemptLabelMatch(unit, indexes);
    if (match) {
      recordMatch(unit, match.question, match.method, match.confidence);
    }
  }

  // Pass 2: semantic fallback — per spec sections 9-10, this applies
  // ONLY to answers with NO detected label at all. A labeled answer
  // whose label simply doesn't match any question (e.g. "9" when no
  // such question exists, or "11(b)" when only 11(a) exists) must NOT
  // fall through to semantic guessing — that would risk exactly the
  // kind of wrong-sub-question mapping section 2 forbids. Those stay
  // unmatched and are reported as such.
  for (const unit of units) {
    if (unit.detectedLabel) continue; // has a label — semantic fallback does not apply
    if (claimedUnitIds.has(unit.rootId)) continue;
    if (!unit.text) continue; // nothing to semantically compare

    const candidateQuestions = questions.filter((q) => !matchedByQuestionId.has(q.id));
    if (candidateQuestions.length === 0) break; // no questions left to consider

    // eslint-disable-next-line no-await-in-loop -- intentionally sequential, see file header
    const semanticResult = await semanticMatchQuestion(unit.text, candidateQuestions);
    if (semanticResult && semanticResult.confidence >= SEMANTIC_MATCH_THRESHOLD) {
      const question = candidateQuestions.find((q) => q.id === semanticResult.questionId);
      if (question) {
        recordMatch(unit, question, "semantic", semanticResult.confidence);
      }
    }
  }

  // Build the final mappings array: one entry per question (matched or unanswered).
  const mappings = questions.map((q) => {
    const match = matchedByQuestionId.get(q.id);
    if (match) {
      return {
        questionId: q.id,
        answerBlockIds: match.blockIds,
        status: "matched",
        matchConfidence: match.confidence,
        matchMethod: match.method,
      };
    }
    return {
      questionId: q.id,
      answerBlockIds: [],
      status: "unanswered",
      matchConfidence: 1,
      matchMethod: null,
    };
  });

  // Build unmatchedAnswers: every block belonging to a unit that never
  // got claimed by any question, reported individually so nothing is
  // silently dropped (section 8).
  const unmatchedAnswers = [];
  for (const unit of units) {
    if (claimedUnitIds.has(unit.rootId)) continue;

    const reason =
      loseReasonByUnitId.get(unit.rootId) ||
      (unit.detectedLabel
        ? `No corresponding question found for label "${unit.detectedLabel}"`
        : "No confident match found for unlabeled answer");

    for (const blockId of unit.blockIds) {
      unmatchedAnswers.push({
        answerBlockId: blockId,
        detectedLabel: unit.detectedLabel,
        reason,
      });
    }
  }

  return { mappings, unmatchedAnswers };
}

module.exports = {
  mapAnswersToQuestions,
  buildAnswerUnits,
  buildQuestionIndexes,
  attemptLabelMatch,
  SEMANTIC_MATCH_THRESHOLD,
};
