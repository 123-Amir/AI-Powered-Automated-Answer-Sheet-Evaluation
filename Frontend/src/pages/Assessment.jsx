import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import FileUploadCard from "../components/FileUploadCard";
import ProcessingProgress from "../components/ProcessingProgress";
import AssessmentSummary from "../components/AssessmentSummary";
import QuestionSidebar from "../components/QuestionSidebar";
import AnswerSheetViewer from "../components/AnswerSheetViewer";
import AnswerDetailsPanel from "../components/AnswerDetailsPanel";
import { startAssessment, getAssessmentStatus, getAssessmentPageUrl, gradeAssessment } from "../services/assessmentApi";
import "./Assessment.css";

const POLL_INTERVAL_MS = 1200;

/** Sorts AnswerBlocks by page (then original relative order for ties) — never by array order alone. Phase 5 section 16. */
function sortBlocksByPage(blocks) {
  return blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => a.block.page - b.block.page || a.index - b.index)
    .map((entry) => entry.block);
}

function Assessment() {
  // --- state machine ------------------------------------------------
  const [phase, setPhase] = useState("upload"); // 'upload' | 'processing' | 'review' | 'error'

  const [questionPaperFile, setQuestionPaperFile] = useState(null);
  const [answerSheetFile, setAnswerSheetFile] = useState(null);

  const [jobId, setJobId] = useState(null);
  const [stage, setStage] = useState("uploading");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  const [result, setResult] = useState(null); // { questions, pages, answerBlocks, mappings, unmatchedAnswers, summary }
  const [errorMessage, setErrorMessage] = useState("");

  const [selection, setSelection] = useState(null); // { type: 'question'|'unmatched', id } | null
  const [currentPage, setCurrentPage] = useState(1);
  const [startError, setStartError] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  // --- Phase 6: grading state -----------------------------------------
  const [gradingState, setGradingState] = useState("idle"); // 'idle' | 'grading' | 'completed' | 'error'
  const [gradingProgress, setGradingProgress] = useState(0);
  const [gradingMessage, setGradingMessage] = useState("");
  const [gradingErrorMessage, setGradingErrorMessage] = useState("");
  const [evaluationResults, setEvaluationResults] = useState(null); // EvaluationResult[] | null
  const [gradingSummary, setGradingSummary] = useState(null);
  const gradingPollTimerRef = useRef(null);

  const pollTimerRef = useRef(null);

  // --- derived lookups (recomputed only when result changes) --------
  const questionsById = useMemo(() => {
    const map = new Map();
    (result?.questions || []).forEach((q) => map.set(q.id, q));
    return map;
  }, [result]);

  const answerBlocksById = useMemo(() => {
    const map = new Map();
    (result?.answerBlocks || []).forEach((b) => map.set(b.id, b));
    return map;
  }, [result]);

  const mappingByQuestionId = useMemo(() => {
    const map = new Map();
    (result?.mappings || []).forEach((m) => map.set(m.questionId, m));
    return map;
  }, [result]);

  const evaluationResultsById = useMemo(() => {
    const map = new Map();
    (evaluationResults || []).forEach((r) => map.set(r.questionId, r));
    return map;
  }, [evaluationResults]);

  // --- polling --------------------------------------------------------
  useEffect(() => {
    if (phase !== "processing" || !jobId) return undefined;

    const poll = async () => {
      try {
        const data = await getAssessmentStatus(jobId);

        if (!data || data.success === false || data.status === "error") {
          setErrorMessage(data?.error || data?.message || "Unable to process this assessment.");
          setPhase("error");
          return;
        }

        setStage(data.stage);
        setProgress(data.progress ?? 0);
        setMessage(data.message || "");

        if (data.status === "completed") {
          setResult(data.result);
          setCurrentPage(data.result?.pages?.[0]?.pageNumber || 1);
          setPhase("review");
        }
      } catch (err) {
        setErrorMessage("Lost connection while checking processing status. Please try again.");
        setPhase("error");
      }
    };

    poll(); // fire immediately, then on the interval
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [phase, jobId]);

  // --- upload screen actions ------------------------------------------
  const handleStartAssessment = useCallback(async () => {
    if (!questionPaperFile || !answerSheetFile) return;

    setIsStarting(true);
    setStartError("");

    try {
      const data = await startAssessment(questionPaperFile, answerSheetFile);
      if (!data?.success || !data?.jobId) {
        setStartError(data?.error || "Could not start processing. Please try again.");
        setIsStarting(false);
        return;
      }
      setJobId(data.jobId);
      setStage("uploading");
      setProgress(0);
      setMessage("Upload received, starting processing...");
      setPhase("processing");
    } catch (err) {
      setStartError(
        err?.response?.data?.error || "Could not reach the server to start processing. Please try again."
      );
    } finally {
      setIsStarting(false);
    }
  }, [questionPaperFile, answerSheetFile]);

  const handleTryAgain = useCallback(() => {
    // Files are intentionally kept so the teacher doesn't have to
    // re-select them — only the job/result/error state resets.
    setJobId(null);
    setResult(null);
    setSelection(null);
    setErrorMessage("");
    setStage("uploading");
    setProgress(0);
    setPhase("upload");
    // A new job means any prior grading no longer applies.
    setGradingState("idle");
    setGradingProgress(0);
    setGradingMessage("");
    setGradingErrorMessage("");
    setEvaluationResults(null);
    setGradingSummary(null);
  }, []);

  const handleStartOver = useCallback(() => {
    setQuestionPaperFile(null);
    setAnswerSheetFile(null);
    handleTryAgain();
  }, [handleTryAgain]);

  // --- Phase 6: evaluate assessment -------------------------------------
  const handleEvaluate = useCallback(async () => {
    if (!jobId || gradingState === "grading") return;

    setGradingState("grading");
    setGradingProgress(0);
    setGradingMessage("Starting evaluation...");
    setGradingErrorMessage("");

    // The POST below runs until grading finishes and returns the full
    // result — but Node's event loop interleaves it with the concurrent
    // GET polls started here, so this progress is real (surfaced live
    // via job.grading on the SAME status endpoint Phase 4 already
    // uses), never a fake/simulated timer.
    gradingPollTimerRef.current = setInterval(async () => {
      try {
        const data = await getAssessmentStatus(jobId);
        if (data?.grading) {
          setGradingProgress(data.grading.progress ?? 0);
          setGradingMessage(data.grading.message || "");
        }
      } catch (err) {
        // Transient poll failures are non-fatal — the grade request
        // itself is still the source of truth for the final outcome.
      }
    }, 700);

    try {
      const data = await gradeAssessment(jobId);

      if (!data?.success) {
        setGradingErrorMessage(data?.error || "Unable to grade this assessment.");
        setGradingState("error");
        return;
      }

      setEvaluationResults(data.results || []);
      setGradingSummary(data.summary || null);
      setGradingProgress(100);
      setGradingMessage("Grading complete.");
      setGradingState("completed");
    } catch (err) {
      setGradingErrorMessage(
        err?.response?.data?.error || "Could not reach the server to grade this assessment."
      );
      setGradingState("error");
    } finally {
      if (gradingPollTimerRef.current) {
        clearInterval(gradingPollTimerRef.current);
        gradingPollTimerRef.current = null;
      }
    }
  }, [jobId, gradingState]);

  useEffect(() => {
    return () => {
      if (gradingPollTimerRef.current) clearInterval(gradingPollTimerRef.current);
    };
  }, []);

  // --- review screen actions -------------------------------------------
  const handleSelectQuestion = useCallback(
    (questionId) => {
      setSelection({ type: "question", id: questionId });

      const mapping = mappingByQuestionId.get(questionId);
      // Section 13: unanswered questions must NEVER trigger navigation
      // or a fabricated highlight — only matched questions with at
      // least one resolvable AnswerBlock move the viewer.
      if (mapping && mapping.status === "matched" && mapping.answerBlockIds.length > 0) {
        const blocks = sortBlocksByPage(
          mapping.answerBlockIds.map((id) => answerBlocksById.get(id)).filter(Boolean)
        );
        if (blocks.length > 0) setCurrentPage(blocks[0].page);
      }
    },
    [mappingByQuestionId, answerBlocksById]
  );

  const handleSelectUnmatched = useCallback(
    (answerBlockId) => {
      setSelection({ type: "unmatched", id: answerBlockId });
      const block = answerBlocksById.get(answerBlockId);
      if (block) setCurrentPage(block.page);
    },
    [answerBlocksById]
  );

  // Highlights are computed fresh for whatever page is currently shown
  // — the ONLY inputs are the selected mapping/block's real page +
  // normalized boundingBox (see Phase 5 section 31). Never derived from
  // question/page/array order.
  const highlightsForCurrentPage = useMemo(() => {
    if (!selection) return [];

    if (selection.type === "unmatched") {
      const block = answerBlocksById.get(selection.id);
      if (!block || block.page !== currentPage) return [];
      return [
        {
          id: block.id,
          boundingBox: block.boundingBox,
          label: `Unmatched${block.detectedLabel ? ` ${block.detectedLabel}` : ""}`,
          active: true,
        },
      ];
    }

    const mapping = mappingByQuestionId.get(selection.id);
    if (!mapping || mapping.status !== "matched") return [];
    const question = questionsById.get(selection.id);

    return mapping.answerBlockIds
      .map((id) => answerBlocksById.get(id))
      .filter((b) => b && b.page === currentPage)
      .map((b) => ({
        id: b.id,
        boundingBox: b.boundingBox,
        label: `Answer ${question?.displayLabel || ""}`.trim(),
        active: true,
      }));
  }, [selection, currentPage, mappingByQuestionId, answerBlocksById, questionsById]);

  const selectedQuestion = selection?.type === "question" ? questionsById.get(selection.id) : null;
  const selectedMapping = selection?.type === "question" ? mappingByQuestionId.get(selection.id) : null;
  const selectedAnswerBlocks = useMemo(() => {
    if (!selectedMapping || selectedMapping.status !== "matched") return [];
    return sortBlocksByPage(
      selectedMapping.answerBlockIds.map((id) => answerBlocksById.get(id)).filter(Boolean)
    );
  }, [selectedMapping, answerBlocksById]);

  const unmatchedEntry =
    selection?.type === "unmatched"
      ? (result?.unmatchedAnswers || []).find((u) => u.answerBlockId === selection.id)
      : null;
  const unmatchedBlock = selection?.type === "unmatched" ? answerBlocksById.get(selection.id) : null;

  const selectedEvaluation =
    selection?.type === "question" ? evaluationResultsById.get(selection.id) || null : null;

  const pagesForViewer = useMemo(
    () => (result?.pages || []).map((p) => ({ ...p, imageUrl: getAssessmentPageUrl(jobId, p.pageNumber) })),
    [result, jobId]
  );

  // --- render ------------------------------------------------------------

  if (phase === "upload") {
    const canStart = !!questionPaperFile && !!answerSheetFile && !isStarting;
    return (
      <div className="assess-page assess-page-centered">
        <div className="assess-upload-wrap">
          <h1 className="assess-title">Assess a Student's Paper</h1>
          <p className="assess-subtitle">
            Upload the question paper and the student's handwritten answer sheet to get started.
          </p>

          <div className="assess-upload-grid">
            <FileUploadCard
              label="Question Paper"
              file={questionPaperFile}
              onSelect={setQuestionPaperFile}
              onRemove={() => setQuestionPaperFile(null)}
            />
            <FileUploadCard
              label="Student Answer Sheet"
              file={answerSheetFile}
              onSelect={setAnswerSheetFile}
              onRemove={() => setAnswerSheetFile(null)}
            />
          </div>

          {startError && <p className="assess-start-error">{startError}</p>}

          <button type="button" className="assess-primary-btn" disabled={!canStart} onClick={handleStartAssessment}>
            {isStarting ? "Starting..." : "Process Assessment"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "processing") {
    return (
      <div className="assess-page assess-page-centered">
        <ProcessingProgress stage={stage} progress={progress} message={message} />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="assess-page assess-page-centered">
        <div className="assess-error-card">
          <h2 className="assess-error-title">Something went wrong</h2>
          <p className="assess-error-message">{errorMessage}</p>
          <button type="button" className="assess-primary-btn" onClick={handleTryAgain}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // phase === "review"
  const noQuestions = (result?.questions || []).length === 0;
  const noAnswers = (result?.answerBlocks || []).length === 0;

  return (
    <div className="assess-page">
      <div className="assess-review-header">
        <div>
          <h1 className="assess-title assess-title-compact">Assessment Review</h1>
          {noAnswers && !noQuestions && (
            <p className="assess-empty-banner">No student answers were detected on the uploaded sheet.</p>
          )}
        </div>
        <button type="button" className="assess-secondary-btn" onClick={handleStartOver}>
          Start New Assessment
        </button>
      </div>

      <AssessmentSummary summary={result?.summary} gradingSummary={gradingSummary} />

      {result?.summary && (
        <div className="assess-grading-bar">
          {gradingState === "idle" && (
            <>
              <span className="assess-grading-hint">
                Review complete. {result.summary.answered} answered, {result.summary.unanswered} unanswered
                {result.summary.unmatchedAnswers > 0 ? `, ${result.summary.unmatchedAnswers} unmatched` : ""}.
              </span>
              <button
                type="button"
                className="assess-primary-btn assess-evaluate-btn"
                onClick={handleEvaluate}
                disabled={result.summary.answered === 0}
              >
                Evaluate Assessment
              </button>
            </>
          )}

          {gradingState === "grading" && (
            <div className="assess-grading-progress">
              <div className="assess-grading-progress-track">
                <div className="assess-grading-progress-fill" style={{ width: `${gradingProgress}%` }} />
              </div>
              <span className="assess-grading-hint">{gradingMessage || "Evaluating..."}</span>
            </div>
          )}

          {gradingState === "error" && (
            <>
              <span className="assess-grading-hint assess-grading-error">{gradingErrorMessage}</span>
              <button type="button" className="assess-secondary-btn" onClick={handleEvaluate}>
                Try Evaluating Again
              </button>
            </>
          )}

          {gradingState === "completed" && (
            <button type="button" className="assess-secondary-btn" onClick={handleEvaluate}>
              Re-evaluate Assessment
            </button>
          )}
        </div>
      )}

      {noQuestions ? (
        <p className="assess-empty-banner">No questions could be extracted from this paper.</p>
      ) : (
        <div className="assess-review-grid">
          <div className="assess-pane assess-pane-sidebar">
            <QuestionSidebar
              questions={result.questions}
              mappingByQuestionId={mappingByQuestionId}
              unmatchedAnswers={result.unmatchedAnswers || []}
              selection={selection}
              onSelectQuestion={handleSelectQuestion}
              onSelectUnmatched={handleSelectUnmatched}
              answerBlocksById={answerBlocksById}
              evaluationResultsById={evaluationResultsById}
            />
          </div>

          <div className="assess-pane assess-pane-viewer">
            <AnswerSheetViewer
              pages={pagesForViewer}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              highlights={highlightsForCurrentPage}
            />
          </div>

          <div className="assess-pane assess-pane-details">
            <AnswerDetailsPanel
              selection={selection}
              question={selectedQuestion}
              mapping={selectedMapping}
              answerBlocks={selectedAnswerBlocks}
              unmatchedEntry={unmatchedEntry}
              unmatchedBlock={unmatchedBlock}
              currentPage={currentPage}
              onNavigateToPage={setCurrentPage}
              evaluation={selectedEvaluation}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default Assessment;
