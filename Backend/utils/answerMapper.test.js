/**
 * Offline test suite for answerMapper.js / labelNormalizer.js.
 *
 * No test framework dependency added — uses Node's built-in `assert`
 * so `npm test` doesn't require installing anything new. Runs fully
 * offline: with no GEMINI_API configured (the default in this sandbox),
 * semanticMatcher.js automatically falls back to its dependency-free
 * lexical heuristic, so Test 6 exercises real fallback behavior, not a
 * mock.
 *
 * Run with:  node utils/answerMapper.test.js
 */

const assert = require("assert");
const { mapAnswersToQuestions } = require("./answerMapper");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`❌ ${name}`);
    console.log(`   ${err.message}`);
  }
}

// --- fixture helpers -------------------------------------------------

function makeQuestion(number, subLabel, text = "Sample question text") {
  const displayLabel = subLabel ? `${number}(${subLabel})` : number;
  return {
    id: `q_${number}${subLabel || ""}`,
    number,
    subLabel: subLabel || null,
    displayLabel,
    text,
    order: 0,
    page: 1,
    marksPossible: null,
  };
}

function makeAnswer(id, detectedLabel, text = "Sample answer text", extra = {}) {
  return {
    id,
    detectedLabel,
    text,
    page: 1,
    boundingBox: null,
    pageWidthPx: null,
    pageHeightPx: null,
    confidence: 0.9,
    spansMultiplePages: false,
    continuationOf: null,
    continuedBy: null,
    ...extra,
  };
}

function mappingFor(result, questionId) {
  return result.mappings.find((m) => m.questionId === questionId);
}

// --- tests -------------------------------------------------------------

async function run() {
  await test("TEST 1: all matched (1,2,3 <-> 1,2,3)", async () => {
    const questions = [makeQuestion("1"), makeQuestion("2"), makeQuestion("3")];
    const answers = [makeAnswer("ab_001", "1"), makeAnswer("ab_002", "2"), makeAnswer("ab_003", "3")];
    const result = await mapAnswersToQuestions(questions, answers);
    for (const q of questions) {
      assert.strictEqual(mappingFor(result, q.id).status, "matched", `${q.id} should be matched`);
    }
    assert.strictEqual(result.unmatchedAnswers.length, 0);
  });

  await test("TEST 2: out-of-order (questions 1,2,3 / answers 3,1)", async () => {
    const questions = [makeQuestion("1"), makeQuestion("2"), makeQuestion("3")];
    const answers = [makeAnswer("ab_001", "3"), makeAnswer("ab_002", "1")];
    const result = await mapAnswersToQuestions(questions, answers);
    assert.strictEqual(mappingFor(result, "q_1").status, "matched");
    assert.deepStrictEqual(mappingFor(result, "q_1").answerBlockIds, ["ab_002"]);
    assert.strictEqual(mappingFor(result, "q_2").status, "unanswered");
    assert.strictEqual(mappingFor(result, "q_3").status, "matched");
    assert.deepStrictEqual(mappingFor(result, "q_3").answerBlockIds, ["ab_001"]);
  });

  await test("TEST 3: reversed sub-part order (11(a),11(b) <- answers 11(b),11(a))", async () => {
    const questions = [makeQuestion("11", "a"), makeQuestion("11", "b")];
    const answers = [makeAnswer("ab_001", "11(b)"), makeAnswer("ab_002", "11(a)")];
    const result = await mapAnswersToQuestions(questions, answers);
    assert.deepStrictEqual(mappingFor(result, "q_11a").answerBlockIds, ["ab_002"]);
    assert.deepStrictEqual(mappingFor(result, "q_11b").answerBlockIds, ["ab_001"]);
  });

  await test("TEST 4: unanswered + unmatched (questions 1,2,3 / answers 1,3,9)", async () => {
    const questions = [makeQuestion("1"), makeQuestion("2"), makeQuestion("3")];
    const answers = [makeAnswer("ab_001", "1"), makeAnswer("ab_002", "3"), makeAnswer("ab_003", "9")];
    const result = await mapAnswersToQuestions(questions, answers);
    assert.strictEqual(mappingFor(result, "q_2").status, "unanswered");
    assert.strictEqual(result.unmatchedAnswers.length, 1);
    assert.strictEqual(result.unmatchedAnswers[0].answerBlockId, "ab_003");
    assert.strictEqual(result.unmatchedAnswers[0].detectedLabel, "9");
  });

  await test("TEST 5: multi-page answer (11(a) split across two blocks)", async () => {
    const questions = [makeQuestion("11", "a")];
    const answers = [
      makeAnswer("ab_001", "11(a)", "Start of the answer...", { continuedBy: "ab_002" }),
      makeAnswer("ab_002", null, "...and the rest of it.", { continuationOf: "ab_001" }),
    ];
    const result = await mapAnswersToQuestions(questions, answers);
    assert.strictEqual(mappingFor(result, "q_11a").status, "matched");
    assert.deepStrictEqual(mappingFor(result, "q_11a").answerBlockIds, ["ab_001", "ab_002"]);
  });

  await test("TEST 6: unlabeled answer must NOT be blindly index-mapped", async () => {
    const questions = [
      makeQuestion("1", null, "Describe the water cycle and evaporation process."),
      makeQuestion("2", null, "Explain Newtons laws of motion and gravity."),
    ];
    // Deliberately unrelated content to both questions -> should stay unmatched,
    // NOT get assigned to question 1 just because it's array position 0.
    const answers = [makeAnswer("ab_001", null, "The capital of France is Paris, a city in Europe.")];
    const result = await mapAnswersToQuestions(questions, answers);
    assert.strictEqual(mappingFor(result, "q_1").status, "unanswered");
    assert.strictEqual(mappingFor(result, "q_2").status, "unanswered");
    assert.strictEqual(result.unmatchedAnswers.length, 1);
    assert.strictEqual(result.unmatchedAnswers[0].answerBlockId, "ab_001");
  });

  await test("TEST 7: no cross-mapping between sibling sub-parts (11(a),11(b) exact answers)", async () => {
    const questions = [makeQuestion("11", "a"), makeQuestion("11", "b")];
    const answers = [makeAnswer("ab_001", "11(a)"), makeAnswer("ab_002", "11(b)")];
    const result = await mapAnswersToQuestions(questions, answers);
    assert.deepStrictEqual(mappingFor(result, "q_11a").answerBlockIds, ["ab_001"]);
    assert.deepStrictEqual(mappingFor(result, "q_11b").answerBlockIds, ["ab_002"]);
  });

  await test("TEST 8: normalized match (\"Q11 (a)\" -> 11(a))", async () => {
    const questions = [makeQuestion("11", "a")];
    const answers = [makeAnswer("ab_001", "Q11 (a)")];
    const result = await mapAnswersToQuestions(questions, answers);
    const mapping = mappingFor(result, "q_11a");
    assert.strictEqual(mapping.status, "matched");
    assert.strictEqual(mapping.matchMethod, "label_normalized");
  });

  // --- extra coverage beyond the required 8 ---------------------------

  await test("EXTRA: 11(b) must never match an 11(a) answer, and vice versa", async () => {
    const questions = [makeQuestion("11", "a")];
    const answers = [makeAnswer("ab_001", "11(b)")]; // wrong sub-part, question 11(a) exists but must stay unanswered
    const result = await mapAnswersToQuestions(questions, answers);
    assert.strictEqual(mappingFor(result, "q_11a").status, "unanswered");
    assert.strictEqual(result.unmatchedAnswers[0].answerBlockId, "ab_001");
  });

  await test("EXTRA: 11(a) must never match a 12(a) answer", async () => {
    const questions = [makeQuestion("11", "a")];
    const answers = [makeAnswer("ab_001", "12(a)")];
    const result = await mapAnswersToQuestions(questions, answers);
    assert.strictEqual(mappingFor(result, "q_11a").status, "unanswered");
  });

  await test("EXTRA: duplicate same-label answers combine into one mapping", async () => {
    const questions = [makeQuestion("11", "a")];
    const answers = [makeAnswer("ab_001", "11(a)"), makeAnswer("ab_002", "11(a)")];
    const result = await mapAnswersToQuestions(questions, answers);
    const mapping = mappingFor(result, "q_11a");
    assert.strictEqual(mapping.status, "matched");
    assert.deepStrictEqual(mapping.answerBlockIds.sort(), ["ab_001", "ab_002"]);
  });

  await test("EXTRA: fuzzy tier recovers a noisy label (\"Ans 11(a):\")", async () => {
    const questions = [makeQuestion("11", "a")];
    const answers = [makeAnswer("ab_001", "Ans 11(a):")];
    const result = await mapAnswersToQuestions(questions, answers);
    const mapping = mappingFor(result, "q_11a");
    assert.strictEqual(mapping.status, "matched");
    assert.strictEqual(mapping.matchMethod, "label_fuzzy");
  });

  await test("EXTRA: bare '11' question is distinct from '11(a)' answer", async () => {
    const questions = [makeQuestion("11", null)];
    const answers = [makeAnswer("ab_001", "11(a)")];
    const result = await mapAnswersToQuestions(questions, answers);
    assert.strictEqual(mappingFor(result, "q_11").status, "unanswered");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
