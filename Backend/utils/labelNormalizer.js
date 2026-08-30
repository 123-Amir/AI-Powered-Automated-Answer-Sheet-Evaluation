/**
 * Normalizes question/answer labels such as "11(a)", "11 (a)", "11-a",
 * "11 - a", "11.a", "Q11(a)", "Q.11(a)", "Question 11(a)" into a single
 * canonical form: "11(a)".
 *
 * A plain root question with no sub-part ("11") normalizes to "11" —
 * it must NEVER collide with "11(a)" (see Phase 3 spec, section 4).
 *
 * Returns null when the input isn't a recognizable question-style
 * label at all (e.g. no leading number) — callers must treat null as
 * "cannot normalize", never as a wildcard/match-anything value.
 */

// Sub-labels are letters only (this covers both alphabetic sub-parts
// like "a","b" AND roman numerals like "i","ii","iii" since both use
// a-z). We deliberately do NOT try to distinguish "is this roman or
// alphabetic" — the canonical string is the same either way and that's
// all matching needs.
const SUB_LABEL_PATTERN = /^[a-z]+$/;

// A numeric sub-label (e.g. "11.1" -> sub-part "1") is only trusted
// when an explicit separator was present before it — otherwise a bare
// number like "111" could just as easily be an entirely different
// question number, and we must not invent a sub-part split.
const NUMERIC_SUB_LABEL_PATTERN = /^\d{1,2}$/;

function normalizeQuestionLabel(rawLabel) {
  if (rawLabel === null || rawLabel === undefined) return null;

  let s = String(rawLabel).trim();
  if (!s) return null;

  // Strip common prefixes: "Question 11(a)", "Q11(a)", "Q.11(a)", "Q. 11(a)"
  s = s.replace(/^question\s+/i, "").trim();
  s = s.replace(/^q\.?\s*/i, "").trim();

  const numberMatch = s.match(/^(\d+)/);
  if (!numberMatch) return null; // not a recognizable question-style label

  const number = numberMatch[1];
  let rest = s.slice(numberMatch[0].length);

  // Consume a separator run: parentheses, dash, dot, whitespace, in any
  // combination (e.g. " - ", "(", ". ").
  const separatorMatch = rest.match(/^\s*[().\-\s]+\s*/);
  const hadSeparator = !!separatorMatch && separatorMatch[0].trim() !== "";
  if (separatorMatch) {
    rest = rest.slice(separatorMatch[0].length);
  }

  // Strip a single trailing ")" and trailing whitespace, if present.
  rest = rest.replace(/\s*\)\s*$/, "").trim();

  if (!rest) {
    return number; // root question only, no sub-part
  }

  const lower = rest.toLowerCase();

  if (SUB_LABEL_PATTERN.test(lower)) {
    return `${number}(${lower})`;
  }

  if (hadSeparator && NUMERIC_SUB_LABEL_PATTERN.test(lower)) {
    return `${number}(${lower})`;
  }

  // Unrecognized trailing content — do not guess.
  return null;
}

// Common OCR/handwriting look-alike characters, used ONLY to correct
// the LEADING root-number portion of a label (e.g. "ll(a)" -> "11(a)")
// — never applied to the sub-label letters, since a single-character
// change there (e.g. "a" -> "b") would silently point to a genuinely
// different sub-question. This keeps the "fuzzy" tier conservative.
const OCR_LOOKALIKES = { l: "1", i: "1", o: "0", s: "5", b: "8", z: "2" };

/**
 * Attempts to correct OCR-style look-alike characters at the very
 * start of a label, stopping at the first character that isn't a
 * digit or a known look-alike. Returns null if no correction was
 * applicable (nothing to fix at the start).
 */
function ocrCorrectLeadingNumber(rawLabel) {
  if (!rawLabel) return null;
  const s = String(rawLabel).trim();
  let result = "";
  let i = 0;
  let changed = false;

  while (i < s.length) {
    const ch = s[i];
    if (/\d/.test(ch)) {
      result += ch;
      i += 1;
      continue;
    }
    const lower = ch.toLowerCase();
    if (OCR_LOOKALIKES[lower]) {
      result += OCR_LOOKALIKES[lower];
      changed = true;
      i += 1;
      continue;
    }
    break;
  }

  if (!changed || result.length === 0) return null;
  return result + s.slice(i);
}

/**
 * Minimal-touch normalization for the "exact" match tier: only trims,
 * lowercases, and collapses internal whitespace runs. Deliberately does
 * NOT touch delimiters/punctuation — that's what distinguishes
 * "label_exact" from "label_normalized".
 */
function rawNormalize(label) {
  if (label === null || label === undefined) return null;
  const s = String(label).trim().toLowerCase().replace(/\s+/g, " ");
  return s || null;
}

module.exports = { normalizeQuestionLabel, ocrCorrectLeadingNumber, rawNormalize };
