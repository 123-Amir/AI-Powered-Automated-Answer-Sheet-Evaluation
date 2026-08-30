import "./AssessmentSummary.css";

/**
 * Top summary bar. All numbers come straight from the backend's
 * result.summary (computed server-side from actual mapping data —
 * see Phase 4 assessmentPipeline.js) — never recomputed/guessed here.
 *
 * `gradingSummary` (Phase 6, optional) adds Score/Percentage once the
 * teacher has run "Evaluate Assessment" — omitted entirely beforehand.
 */
function AssessmentSummary({ summary, gradingSummary }) {
  if (!summary) return null;

  const items = [
    { label: "Questions", value: summary.totalQuestions },
    { label: "Answered", value: summary.answered, tone: "good" },
    { label: "Unanswered", value: summary.unanswered, tone: "neutral" },
    { label: "Unmatched Answers", value: summary.unmatchedAnswers, tone: summary.unmatchedAnswers > 0 ? "warn" : "neutral" },
  ];

  if (gradingSummary && typeof gradingSummary.totalMarks === "number") {
    items.push({
      label: "Score",
      value: `${gradingSummary.marksAwarded} / ${gradingSummary.totalMarks}`,
      tone: "good",
    });
    if (typeof gradingSummary.percentage === "number") {
      items.push({ label: "Percentage", value: `${gradingSummary.percentage}%`, tone: "good" });
    }
    if (gradingSummary.evaluationErrors > 0) {
      items.push({ label: "Evaluation Errors", value: gradingSummary.evaluationErrors, tone: "warn" });
    }
  }

  return (
    <div className="asum-root">
      {items.map((item) => (
        <div className="asum-item" key={item.label}>
          <span className={`asum-value asum-value-${item.tone || "default"}`}>{item.value}</span>
          <span className="asum-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export default AssessmentSummary;
