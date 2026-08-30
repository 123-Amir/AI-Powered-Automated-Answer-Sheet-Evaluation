import "./AnswerDetailsPanel.css";

const MATCH_METHOD_LABELS = {
  label_exact: "Exact label match",
  label_normalized: "Normalized label match",
  label_fuzzy: "Fuzzy label match",
  semantic: "Content-based match",
};

const CORRECTNESS_LABELS = {
  correct: "Correct",
  mostly_correct: "Mostly Correct",
  partially_correct: "Partially Correct",
  incorrect: "Incorrect",
};

/**
 * Right-hand panel showing details for whatever is currently selected
 * in the sidebar: a matched question, an unanswered question, or an
 * unmatched answer. Purely presentational — Assessment.jsx resolves
 * all ids into actual objects and page-sorts multi-block answers
 * before passing them in (see combineAnswerText/sortBlocksByPage
 * there), per Phase 5 section 16.
 *
 * Props:
 *  - selection: { type: 'question'|'unmatched', id } | null
 *  - question: Question | null
 *  - mapping: AnswerMapping | null
 *  - answerBlocks: AnswerBlock[] (already sorted by page, for this selection)
 *  - unmatchedEntry: { answerBlockId, detectedLabel, reason } | null
 *  - unmatchedBlock: AnswerBlock | null
 *  - currentPage: number
 *  - onNavigateToPage: (pageNumber) => void
 *  - evaluation: EvaluationResult | null (Phase 6, optional — omitted before grading)
 */
function AnswerDetailsPanel({
  selection,
  question,
  mapping,
  answerBlocks,
  unmatchedEntry,
  unmatchedBlock,
  currentPage,
  onNavigateToPage,
  evaluation,
}) {
  if (!selection) {
    return (
      <div className="adp-root adp-empty">
        <p>Select a question to see its details here.</p>
      </div>
    );
  }

  if (selection.type === "unmatched") {
    return (
      <div className="adp-root">
        <div className="adp-badge adp-badge-warn">Unmatched Answer</div>
        <h3 className="adp-heading">{unmatchedEntry?.detectedLabel || "Unlabeled"}</h3>
        <p className="adp-hint">{unmatchedEntry?.reason}</p>

        <div className="adp-section">
          <div className="adp-section-title">Extracted Text</div>
          <p className="adp-body-text">{unmatchedBlock?.text || "(no text extracted)"}</p>
        </div>

        {unmatchedBlock && !unmatchedBlock.boundingBox && (
          <p className="adp-hint adp-hint-strong">Answer region could not be located precisely.</p>
        )}

        <div className="adp-meta-row">
          <div className="adp-meta-item">
            <span className="adp-meta-label">Page</span>
            <span className="adp-meta-value">{unmatchedBlock?.page ?? "—"}</span>
          </div>
        </div>
      </div>
    );
  }

  // selection.type === "question"
  const isMatched = mapping && mapping.status === "matched" && answerBlocks.length > 0;

  if (!isMatched) {
    return (
      <div className="adp-root">
        <div className="adp-badge adp-badge-neutral">Not Answered</div>
        <h3 className="adp-heading">{question?.displayLabel}</h3>

        {question?.text && (
          <div className="adp-section">
            <div className="adp-section-title">Question</div>
            <p className="adp-body-text">{question.text}</p>
          </div>
        )}

        <p className="adp-hint adp-hint-strong">
          No answer detected for this question. This is an unanswered question.
        </p>
      </div>
    );
  }

  const combinedText = answerBlocks
    .map((b) => b.text)
    .filter(Boolean)
    .join("\n\n");

  const pageNumbers = [...new Set(answerBlocks.map((b) => b.page))];
  const spansMultiplePages = pageNumbers.length > 1;
  const confidencePct = Math.round((mapping.matchConfidence ?? 0) * 100);

  return (
    <div className="adp-root">
      <div className="adp-badge adp-badge-good">Answered</div>
      <h3 className="adp-heading">{question?.displayLabel}</h3>

      {question?.text && (
        <div className="adp-section">
          <div className="adp-section-title">Question</div>
          <p className="adp-body-text">{question.text}</p>
        </div>
      )}

      <div className="adp-section">
        <div className="adp-section-title">Student Answer</div>
        <p className="adp-body-text adp-answer-text">{combinedText || "(no text extracted)"}</p>
      </div>

      {answerBlocks.length > 0 && answerBlocks.every((b) => !b.boundingBox) && (
        <p className="adp-hint adp-hint-strong">Answer region could not be located precisely.</p>
      )}

      {evaluation && evaluation.status === "evaluated" && (
        <div className="adp-section adp-eval-section">
          <div className="adp-eval-header">
            {typeof evaluation.marksAwarded === "number" && typeof evaluation.marksPossible === "number" ? (
              <span className="adp-eval-score">
                {evaluation.marksAwarded} / {evaluation.marksPossible}
              </span>
            ) : (
              <span className="adp-eval-score adp-eval-score-unscaled">Reviewed</span>
            )}
            {evaluation.correctness && (
              <span className={`adp-eval-correctness adp-eval-correctness-${evaluation.correctness}`}>
                {CORRECTNESS_LABELS[evaluation.correctness] || evaluation.correctness}
              </span>
            )}
          </div>

          {evaluation.feedback && (
            <div className="adp-section">
              <div className="adp-section-title">Feedback</div>
              <p className="adp-body-text">{evaluation.feedback}</p>
            </div>
          )}

          {evaluation.strengths?.length > 0 && (
            <div className="adp-section">
              <div className="adp-section-title">Strengths</div>
              <ul className="adp-eval-list adp-eval-list-good">
                {evaluation.strengths.map((s, i) => (
                  <li key={i}>✓ {s}</li>
                ))}
              </ul>
            </div>
          )}

          {evaluation.improvements?.length > 0 && (
            <div className="adp-section">
              <div className="adp-section-title">Improvements</div>
              <ul className="adp-eval-list adp-eval-list-warn">
                {evaluation.improvements.map((s, i) => (
                  <li key={i}>→ {s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {evaluation && evaluation.status === "error" && (
        <p className="adp-hint adp-hint-strong">This question could not be evaluated: {evaluation.feedback}</p>
      )}

      {spansMultiplePages && (
        <div className="adp-section">
          <div className="adp-section-title">Answer spans {pageNumbers.length} pages</div>
          <div className="adp-page-pills">
            {pageNumbers.map((pageNum, idx) => (
              <button
                key={pageNum}
                type="button"
                className={`adp-page-pill${pageNum === currentPage ? " adp-page-pill-active" : ""}`}
                onClick={() => onNavigateToPage(pageNum)}
              >
                Part {idx + 1}/{pageNumbers.length} · Page {pageNum}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="adp-meta-row">
        <div className="adp-meta-item">
          <span className="adp-meta-label">{spansMultiplePages ? "Pages" : "Page"}</span>
          <span className="adp-meta-value">{pageNumbers.join(", ")}</span>
        </div>
        <div className="adp-meta-item">
          <span className="adp-meta-label">Match confidence</span>
          <span className="adp-meta-value">{confidencePct}%</span>
        </div>
        {mapping.matchMethod && (
          <div className="adp-meta-item">
            <span className="adp-meta-label">Match method</span>
            <span className="adp-meta-value">{MATCH_METHOD_LABELS[mapping.matchMethod] || mapping.matchMethod}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default AnswerDetailsPanel;
