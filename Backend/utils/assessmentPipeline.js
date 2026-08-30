/**
 * Orchestrates the end-to-end assessment processing job:
 *   extract questions -> extract answers -> map answers -> done
 *
 * Deliberately thin: every extraction/mapping step calls the EXISTING
 * Phase 1-3 utilities directly (no copy-pasted logic). This file's
 * only job is sequencing, progress reporting, and error handling.
 */

const { extractQuestionsFromDocument, QuestionExtractionError } = require("./questionExtractor");
const { extractAnswersFromDocument, AnswerExtractionError } = require("./answerSheetExtractor");
const { mapAnswersToQuestions } = require("./answerMapper");
const { updateJob, storePageImages } = require("./jobStore");

// Progress boundaries per Phase 4 spec section 5.
const PROGRESS = {
  UPLOADING: 5,
  QUESTIONS_START: 15,
  QUESTIONS_DONE: 40,
  ANSWERS_START: 40,
  ANSWERS_DONE: 75,
  MAPPING_START: 80,
  MAPPING_DONE: 95,
  COMPLETED: 100,
};

/**
 * Returns a safe, human-readable message for the client — never leaks
 * stack traces, env vars, or raw internal error objects. Our own
 * typed extraction errors already carry a clean message; anything else
 * (unexpected/internal) is replaced with a generic message, with the
 * real error still logged server-side for debugging.
 */
function safeErrorMessage(err) {
  if (err instanceof QuestionExtractionError || err instanceof AnswerExtractionError) {
    return err.message;
  }
  return "An internal error occurred while processing the assessment.";
}

/**
 * Runs the full pipeline for a job and updates the job store as it
 * progresses. Never throws — all failures are captured and written
 * into the job's "error" state instead, since this runs detached from
 * the original HTTP request (see AssessmentRoute.js).
 *
 * @param {string} jobId
 * @param {{questionPaperBuffer:Buffer, questionPaperMimeType:string, answerSheetBuffer:Buffer, answerSheetMimeType:string}} files
 */
async function runAssessmentPipeline(jobId, files) {
  const { questionPaperBuffer, questionPaperMimeType, answerSheetBuffer, answerSheetMimeType } = files;

  try {
    // --- Step 1: extract questions (Phase 1) ---------------------------
    updateJob(jobId, {
      stage: "extracting_questions",
      progress: PROGRESS.QUESTIONS_START,
      message: "Extracting questions from question paper...",
    });

    const questions = await extractQuestionsFromDocument(questionPaperBuffer, questionPaperMimeType);

    // --- Step 2: extract answers (Phase 2), with real page progress ----
    updateJob(jobId, {
      stage: "extracting_answers",
      progress: PROGRESS.ANSWERS_START,
      message: "Reading answer sheet...",
    });

    const answerRange = PROGRESS.ANSWERS_DONE - PROGRESS.ANSWERS_START;
    const { pages, answers: answerBlocks } = await extractAnswersFromDocument(
      answerSheetBuffer,
      answerSheetMimeType,
      ({ pageNumber, totalPages }) => {
        const progress = PROGRESS.ANSWERS_START + Math.round((pageNumber / totalPages) * answerRange);
        updateJob(jobId, {
          progress,
          message:
            totalPages > 1
              ? `Reading answer sheet page ${pageNumber} of ${totalPages}...`
              : "Reading answer sheet...",
        });
      }
    );

    // --- Step 3: map answers to questions (Phase 3) --------------------
    updateJob(jobId, {
      stage: "mapping",
      progress: PROGRESS.MAPPING_START,
      message: "Matching answers to questions...",
    });

    const { mappings, unmatchedAnswers } = await mapAnswersToQuestions(questions, answerBlocks);

    updateJob(jobId, { progress: PROGRESS.MAPPING_DONE });

    // --- Step 4: complete ------------------------------------------------
    const summary = {
      totalQuestions: questions.length,
      answered: mappings.filter((m) => m.status === "matched").length,
      unanswered: mappings.filter((m) => m.status === "unanswered").length,
      unmatchedAnswers: unmatchedAnswers.length,
    };

    // Persist the rendered page images (in memory, alongside the job)
    // so Phase 5's GET /api/assessment/:jobId/page/:pageNumber endpoint
    // can serve them. The `result` object sent to the client must NOT
    // contain raw buffers — only a safe URL the browser can request.
    storePageImages(jobId, pages);
    const pagesForResult = pages.map(({ pageNumber, widthPx, heightPx }) => ({
      pageNumber,
      widthPx,
      heightPx,
      imageUrl: `/api/assessment/${jobId}/page/${pageNumber}`,
    }));

    updateJob(jobId, {
      status: "completed",
      stage: "completed",
      progress: PROGRESS.COMPLETED,
      message: "Assessment ready.",
      result: { questions, pages: pagesForResult, answerBlocks, mappings, unmatchedAnswers, summary },
    });
  } catch (err) {
    console.error(`🚨 [assessmentPipeline] Job ${jobId} failed:`, err);
    updateJob(jobId, {
      status: "error",
      stage: "error",
      progress: 0,
      message: safeErrorMessage(err),
      error: safeErrorMessage(err),
    });
  }
}

module.exports = { runAssessmentPipeline, PROGRESS };
