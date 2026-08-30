import "./QuestionSidebar.css";

/**
 * Left-pane question list. Shows every extracted question in printed
 * order (relies on `questions` already being sorted by Phase 1's
 * `order` field), using each question's displayLabel — never a raw
 * internal id, and never a synthetic "Question N" label.
 *
 * Props:
 *  - questions: Question[]
 *  - mappingByQuestionId: Map<questionId, AnswerMapping>
 *  - unmatchedAnswers: [{ answerBlockId, detectedLabel, reason }]
 *  - selection: { type: 'question'|'unmatched', id } | null
 *  - onSelectQuestion: (questionId) => void
 *  - onSelectUnmatched: (answerBlockId) => void
 *  - answerBlocksById: Map<answerBlockId, AnswerBlock>
 *  - evaluationResultsById: Map<questionId, EvaluationResult> | undefined (Phase 6, optional)
 */
function QuestionSidebar({
  questions,
  mappingByQuestionId,
  unmatchedAnswers,
  selection,
  onSelectQuestion,
  onSelectUnmatched,
  answerBlocksById,
  evaluationResultsById,
}) {
  return (
    <div className="qsidebar-root">
      <div className="qsidebar-header">
        <h2 className="qsidebar-title">Questions</h2>
        <span className="qsidebar-count">{questions.length}</span>
      </div>

      {questions.length === 0 ? (
        <p className="qsidebar-empty">No questions could be extracted from this paper.</p>
      ) : (
        <ul className="qsidebar-list">
          {questions.map((q) => {
            const mapping = mappingByQuestionId.get(q.id);
            const status = mapping ? mapping.status : "unanswered";
            const isSelected = selection?.type === "question" && selection.id === q.id;

            const statusIcon = status === "matched" ? "✓" : "○";
            const statusClass = status === "matched" ? "qsidebar-status-matched" : "qsidebar-status-unanswered";
            const statusLabel = status === "matched" ? "Answered" : "Not answered";

            const evaluation = evaluationResultsById?.get(q.id);
            const hasScore = evaluation && evaluation.status === "evaluated" && typeof evaluation.marksAwarded === "number";

            return (
              <li key={q.id}>
                <button
                  type="button"
                  className={`qsidebar-item${isSelected ? " qsidebar-item-selected" : ""}`}
                  onClick={() => onSelectQuestion(q.id)}
                  aria-pressed={isSelected}
                  aria-label={`Question ${q.displayLabel}, ${statusLabel}${hasScore ? `, scored ${evaluation.marksAwarded} of ${evaluation.marksPossible}` : ""}`}
                  title={hasScore ? `${evaluation.marksAwarded}/${evaluation.marksPossible}` : statusLabel}
                >
                  <span className={`qsidebar-status-icon ${statusClass}`} aria-hidden="true">
                    {statusIcon}
                  </span>
                  <span className="qsidebar-label">{q.displayLabel}</span>
                  {hasScore ? (
                    <span className="qsidebar-score-badge">
                      {evaluation.marksAwarded}/{evaluation.marksPossible}
                    </span>
                  ) : (
                    <span className="qsidebar-status-text">{statusLabel}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {unmatchedAnswers.length > 0 && (
        <div className="qsidebar-unmatched-section">
          <div className="qsidebar-header">
            <h3 className="qsidebar-title qsidebar-title-small">Unmatched Answers</h3>
            <span className="qsidebar-count">{unmatchedAnswers.length}</span>
          </div>
          <ul className="qsidebar-list">
            {unmatchedAnswers.map((u) => {
              const block = answerBlocksById.get(u.answerBlockId);
              const isSelected = selection?.type === "unmatched" && selection.id === u.answerBlockId;
              return (
                <li key={u.answerBlockId}>
                  <button
                    type="button"
                    className={`qsidebar-item qsidebar-item-unmatched${isSelected ? " qsidebar-item-selected" : ""}`}
                    onClick={() => onSelectUnmatched(u.answerBlockId)}
                    aria-pressed={isSelected}
                    aria-label={`Unmatched answer ${u.detectedLabel || "unlabeled"}, page ${block?.page ?? "unknown"}`}
                    title={u.reason}
                  >
                    <span className="qsidebar-status-icon qsidebar-status-unmatched" aria-hidden="true">
                      ⚠
                    </span>
                    <span className="qsidebar-label">{u.detectedLabel ? u.detectedLabel : "Unlabeled"}</span>
                    <span className="qsidebar-status-text">
                      {block ? `Page ${block.page}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default QuestionSidebar;
