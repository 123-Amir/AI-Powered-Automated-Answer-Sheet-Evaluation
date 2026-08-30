import "./ProcessingProgress.css";

// Ordered checklist of pipeline stages. Purely presentational — the
// actual current stage/progress/message always comes from the backend
// poll response (see Assessment.jsx), never a local timer.
const STEPS = [
  { key: "uploading", label: "Upload complete" },
  { key: "extracting_questions", label: "Extracting questions" },
  { key: "extracting_answers", label: "Reading student answer sheet" },
  { key: "mapping", label: "Mapping answers" },
];

function stepState(stepKey, currentStage) {
  const order = STEPS.map((s) => s.key);
  const stepIndex = order.indexOf(stepKey);
  const currentIndex = currentStage === "completed" ? order.length : order.indexOf(currentStage);

  if (currentIndex > stepIndex) return "done";
  if (currentIndex === stepIndex) return "active";
  return "pending";
}

/**
 * Props:
 *  - stage: one of ProcessingStatus.STAGES (backend enum)
 *  - progress: number 0-100
 *  - message: string
 */
function ProcessingProgress({ stage, progress, message }) {
  return (
    <div className="pp-root">
      <h2 className="pp-title">Processing Assessment</h2>

      <ul className="pp-checklist">
        {STEPS.map((step) => {
          const state = stepState(step.key, stage);
          const icon = state === "done" ? "✓" : state === "active" ? "●" : "○";
          return (
            <li key={step.key} className={`pp-step pp-step-${state}`}>
              <span className="pp-step-icon" aria-hidden="true">
                {icon}
              </span>
              <span className="pp-step-label">{step.label}</span>
            </li>
          );
        })}
      </ul>

      <div className="pp-progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="pp-progress-fill" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
      </div>
      <div className="pp-progress-value">{Math.round(progress)}%</div>

      <p className="pp-message">{message}</p>
    </div>
  );
}

export default ProcessingProgress;
