/**
 * In-memory job store for assessment processing jobs.
 *
 * DECISION: the assignment explicitly does not require a database, and
 * job state here is inherently short-lived/ephemeral (a teacher polls
 * until "completed"/"error", then the frontend has everything it
 * needs). A Mongoose model would add persistence machinery (schema,
 * connection dependency, cleanup queries) for no real benefit — an
 * in-memory Map is simpler, matches Phase 1-3's "no unnecessary DB"
 * precedent, and is trivially swappable for Mongo/Redis later if jobs
 * ever need to survive a server restart.
 *
 * Jobs are cleaned up automatically after a TTL so the Map can't grow
 * without bound on a long-running server.
 */

const { createProcessingStatus, STAGES, STATUSES } = require("../models/ProcessingStatus");

const jobs = new Map();

// Page image buffers, kept OUT of the job object itself so they can
// never accidentally leak through a JSON response (StatusRoute.js only
// ever copies specific named fields off the job — but keeping raw
// image bytes in a completely separate store removes that risk
// entirely, by construction, rather than by care at the call site).
// jobId -> Map(pageNumber -> { buffer: Buffer, mimeType: string })
const jobPageImages = new Map();

const JOB_TTL_MS = 30 * 60 * 1000; // finished jobs are kept 30 minutes so the frontend has time to poll the final result
// Safety net only — assessmentPipeline.js and GradingRoute.js already
// catch every failure and move the job to "error", so nothing should
// normally stay "processing" this long. This just guarantees the Map
// can never grow unbounded even in an unforeseen edge case (e.g. a
// future code path that throws outside those try/catches).
const STALE_PROCESSING_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function generateJobId() {
  return `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {{questionPaper: {filename:string, mimeType:string}, answerSheet: {filename:string, mimeType:string}}} meta
 */
function createJob({ questionPaper, answerSheet }) {
  const jobId = generateJobId();
  const job = createProcessingStatus(jobId, { questionPaper, answerSheet });
  jobs.set(jobId, job);
  return job;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

/**
 * Shallow-merges a patch into the job and bumps updatedAt. Validates
 * stage/status against the canonical enums from ProcessingStatus.js so
 * a typo in calling code fails loudly rather than silently corrupting
 * job state. Returns the updated job, or null if it no longer exists
 * (e.g. already cleaned up).
 */
function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return null;

  if (patch.stage !== undefined && !STAGES.includes(patch.stage)) {
    throw new Error(`Invalid job stage: "${patch.stage}"`);
  }
  if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
    throw new Error(`Invalid job status: "${patch.status}"`);
  }

  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

/**
 * Stores rendered page image buffers for a job, so Phase 5's page-image
 * endpoint can serve them later without re-rendering. `pages` is the
 * pagesMeta array returned by answerSheetExtractor.js (each entry may
 * carry a `buffer`/`mimeType` — entries without one, e.g. from a future
 * caller that didn't request images, are simply skipped).
 *
 * @param {string} jobId
 * @param {Array<{pageNumber:number, buffer?:Buffer, mimeType?:string}>} pages
 */
function storePageImages(jobId, pages) {
  const byPage = new Map();
  for (const page of pages) {
    if (page.buffer && page.mimeType) {
      byPage.set(page.pageNumber, { buffer: page.buffer, mimeType: page.mimeType });
    }
  }
  jobPageImages.set(jobId, byPage);
}

/** @returns {{buffer:Buffer, mimeType:string} | null} */
function getPageImage(jobId, pageNumber) {
  const byPage = jobPageImages.get(jobId);
  if (!byPage) return null;
  return byPage.get(Number(pageNumber)) || null;
}

function cleanupFinishedJobs() {
  const now = Date.now();
  let removed = 0;

  for (const [id, job] of jobs) {
    const updatedAt = new Date(job.updatedAt).getTime();
    const age = now - updatedAt;

    const isFinishedAndExpired = (job.status === "completed" || job.status === "error") && age > JOB_TTL_MS;
    const isAbnormallyStale = job.status === "processing" && age > STALE_PROCESSING_TTL_MS;

    if (isFinishedAndExpired || isAbnormallyStale) {
      jobs.delete(id);
      jobPageImages.delete(id); // free the (potentially large) image buffers together with the job
      removed += 1;
    }
  }

  if (removed > 0) {
    console.log(`🧹 [jobStore] Cleaned up ${removed} expired job(s)`);
  }
}

const cleanupTimer = setInterval(cleanupFinishedJobs, CLEANUP_INTERVAL_MS);
// Don't let this background timer keep the process alive on its own
// (relevant for graceful shutdowns / serverless-style environments).
if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();

module.exports = { createJob, getJob, updateJob, generateJobId, cleanupFinishedJobs, storePageImages, getPageImage };
