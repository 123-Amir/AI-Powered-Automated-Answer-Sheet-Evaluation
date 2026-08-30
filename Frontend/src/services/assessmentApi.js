import axios from "axios";

// Matches the existing convention used in Form.jsx.
export const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

/**
 * Starts a new assessment processing job (Phase 4).
 *
 * @param {File} questionPaper
 * @param {File} answerSheet
 * @returns {Promise<{success:boolean, jobId:string, status:string}>}
 */
export async function startAssessment(questionPaper, answerSheet) {
  const formData = new FormData();
  formData.append("questionPaper", questionPaper);
  formData.append("answerSheet", answerSheet);

  const response = await axios.post(`${API_BASE_URL}/api/assessment/process`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  return response.data;
}

/**
 * Builds the full URL for a processed answer-sheet page image. The
 * backend result's `imageUrl` field is already the right relative path
 * (e.g. "/api/assessment/job_abc/page/2") — this just prefixes it with
 * the API base, consistent with how the rest of the app builds URLs.
 *
 * @param {string} jobId
 * @param {number} pageNumber
 * @returns {string}
 */
export function getAssessmentPageUrl(jobId, pageNumber) {
  return `${API_BASE_URL}/api/assessment/${jobId}/page/${pageNumber}`;
}

/**
 * Fetches the current status (and, once completed, the full result)
 * of an assessment processing job.
 *
 * @param {string} jobId
 * @returns {Promise<object>}
 */
export async function getAssessmentStatus(jobId) {
  const response = await axios.get(`${API_BASE_URL}/api/assessment/status/${jobId}`, {
    // A completed/error job is still a normal response for our purposes;
    // let the caller inspect the payload rather than throwing on 4xx.
    validateStatus: (status) => status < 500,
  });

  return response.data;
}

/**
 * Triggers AI grading for a completed assessment job (Phase 6). This
 * call runs until grading finishes and returns the full result, but
 * live progress during that time is available by concurrently polling
 * getAssessmentStatus(jobId) — its response includes a `grading` field
 * once this has been triggered (see Backend/routes/StatusRoute.js).
 *
 * @param {string} jobId
 * @returns {Promise<{success:boolean, results:object[], summary:object, unmatchedAnswers:object[], error?:string}>}
 */
export async function gradeAssessment(jobId) {
  const response = await axios.post(
    `${API_BASE_URL}/api/assessment/${jobId}/grade`,
    {},
    { validateStatus: (status) => status < 500 }
  );

  return response.data;
}
