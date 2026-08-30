# AI Assessment Extraction & Answer Mapping

## Overview

AI-EvaluAIte lets a teacher upload a **question paper** and a student's **handwritten answer sheet** (PDF or images) and automatically:

1. Extracts every question from the question paper, in printed order, preserving original numbering — including labelled sub-parts (e.g. `11(a)`, `11(b)`, `12(i)`, `12(ii)`) as independent questions.
2. Extracts every handwritten answer from the answer sheet, with its detected label (if any), page number, and a normalized bounding box for its location on the page.
3. Maps answers to questions — correctly handling answers written out of order, questions left unanswered, and answers that can't be confidently matched to any question.
4. Lets the teacher click any question and see the **exact answer region highlighted** on the real answer-sheet page image, including answers that span multiple pages.
5. Optionally runs AI grading: marks, correctness, feedback, strengths, and improvements per question, plus an overall score/summary.

```
Question Paper                     Student Answer Sheet
      │                                     │
      ▼                                     ▼
Question Extraction              Answer Extraction (+ bounding boxes)
      │                                     │
      └───────────────┬─────────────────────┘
                       ▼
                Answer Mapping
                       │
                       ▼
            Review UI + Exact Highlighting
                       │
                       ▼
                 AI Grading (optional)
                       │
                       ▼
              Assessment Summary
```

This assignment flow lives alongside the project's original AI-EvaluAIte features (teacher-typed reference answers + AI evaluation, a whiteboard, and a topic→PPT generator), which remain fully functional and untouched.

## Core Features

- PDF and image (JPG/JPEG/PNG) upload for both the question paper and the answer sheet
- Handwritten answer extraction via Gemini Vision, with per-answer bounding boxes
- Question extraction in printed order, with sub-question (`11(a)`/`11(b)`) handling
- Out-of-order answer mapping — array position is never used as identity
- Unanswered-question detection (no AI call made for these)
- Unmatched-answer detection — nothing is ever silently discarded
- Exact answer-region highlighting on the real page image (resize/zoom-safe, percentage-based positioning)
- Multi-page answer support, with part-by-part navigation
- Real, backend-driven processing progress (no fake timers)
- Optional AI grading: marks, correctness, feedback, strengths, improvements
- Assessment-level summary (answered/unanswered/unmatched, score, percentage)

## Architecture

**Backend** (`Backend/`, Node/Express 5): a set of small, composable utilities orchestrated by thin route handlers — no step duplicates another step's logic.

```
Backend/
  routes/
    QuestionPaperRoute.js    POST /api/question-paper       (standalone question extraction)
    AnswerSheetRoute.js      POST /api/answer-sheet         (standalone answer extraction)
    MappingRoute.js          POST /api/map-answers          (standalone mapping)
    AssessmentRoute.js       POST /api/assessment/process   (full pipeline, async job)
    StatusRoute.js           GET  /api/assessment/status/:jobId
    AssessmentPageRoute.js   GET  /api/assessment/:jobId/page/:pageNumber
    GradingRoute.js          POST /api/assessment/:jobId/grade
    (+ original routes: EvaluationRoute, MarksRoute, authRoutes, pptRoutes)
  utils/
    questionExtractor.js     Gemini Vision -> ordered Question[]
    answerSheetExtractor.js  PDF/image -> AnswerBlock[] (text, label, page, bbox, confidence)
    pdfPageRenderer.js       PDF -> per-page raster images (pdfjs-dist + @napi-rs/canvas)
    labelNormalizer.js       "Q11 (a)", "11-a", etc. -> canonical "11(a)"
    answerMapper.js          Question[] + AnswerBlock[] -> AnswerMapping[] (tiered matching)
    semanticMatcher.js       conservative fallback match for unlabeled answers
    answerEvaluator.js       one question's AI grading call
    gradingEngine.js         orchestrates grading across all matched questions
    assessmentPipeline.js    orchestrates extract -> extract -> map for a job
    jobStore.js               in-memory job store + TTL cleanup
  models/
    QuestionPaper.js, ProcessingStatus.js, EvaluationResult.js   (shape references, not persisted)
```

**Frontend** (`Frontend/`, React 19 + Vite): a single state-machine page for the new flow.

```
Frontend/src/
  pages/Assessment.jsx           Upload -> Processing -> Review -> Error states
  components/
    FileUploadCard.jsx           drag/drop upload slot
    ProcessingProgress.jsx       real backend-driven progress checklist
    QuestionSidebar.jsx          question list + unmatched-answers list
    AnswerSheetViewer.jsx        page image + bounding-box highlight overlay
    AnswerDetailsPanel.jsx       question/answer/grading detail panel
    AssessmentSummary.jsx        top summary bar (+ score once graded)
  services/assessmentApi.js      thin API client (no fetch logic duplicated elsewhere)
```

Routing uses `HashRouter` (already the project's convention), so direct URL access and page refresh work correctly on any static host without server-side rewrite rules.

## Tech Stack

- **Frontend:** React 19, Vite, React Router 6 (HashRouter), Axios, react-dropzone, Chart.js (old Scorecard), Framer Motion / react-icons (marketing pages)
- **Backend:** Node.js, Express 5, Mongoose (old auth/evaluation features only — the new assessment flow needs no database), Multer, Passport (Google OAuth, old features only)
- **PDF/image processing:** `pdfjs-dist` + `@napi-rs/canvas` (pure-JS/prebuilt-binary PDF page rendering — no system libraries required), `image-size` (page dimensions for plain image uploads)
- **AI:** Google Gemini API (`@google/generative-ai`)

## AI Model

**Google Gemini**, via the `GEMINI_API` environment variable:
- `gemini-1.5-pro` — question extraction and answer/handwriting extraction (vision)
- `gemini-3.6-flash` — answer mapping's semantic fallback and AI grading (text)

No other AI provider is configured for the new assessment flow. The old evaluation feature (`QnASection.jsx`) additionally uses a client-side Hugging Face call for one optional "auto-generate a reference answer" button — unrelated to this assignment's flow.

## Setup

```bash
git clone <this-repo>

# Backend
cd Backend
npm install
npm run dev             # nodemon, http://localhost:5000

# Frontend (new terminal)
cd Frontend
npm install
npm run dev             # http://localhost:5173
```

### Required environment variables

**Backend/.env**
| Variable | Required for | Notes |
|---|---|---|
| `GEMINI_API` | The entire assessment flow (Phases 1-6) | Get a key at https://aistudio.google.com/apikey |
| `MONGO_URI` | Old auth/evaluation features | Not needed by the new assessment flow itself |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Old Google OAuth login | |
| `SESSION_SECRET` | Session security | Falls back to an insecure dev default if unset — **set this in production** |
| `JWT_SECRET` | Old auth flow | |
| `CLIENT_URL` | CORS | Your deployed frontend origin |
| `PORT` | Server | Defaults to `5000` |

**Frontend/.env**
| Variable | Required for | Notes |
|---|---|---|
| `VITE_BACKEND_URL` | Every API call | Defaults to `http://localhost:5000` locally |
| `VITE_HUGGINGFACE_API_KEY` | Old QnASection auto-answer button only | Not needed for the assessment flow or AI grading |

See `.env.example` in each folder for the full list (names only, no real values).

## Deployment

- **Backend:** any Node host (Render, Railway, Fly.io, etc.). Set all `Backend/.env.example` variables in the host's environment settings. `npm start` runs `node server.js`.
- **Frontend:** any static host (Vercel, Netlify, Render static site). Set `VITE_BACKEND_URL` to the deployed backend's URL, then `npm run build` and serve `dist/`. Because the app uses `HashRouter`, no SPA rewrite/fallback rule is required.
- **CORS:** the backend allows `CLIENT_URL` (your deployed frontend) and `http://localhost:5173` (local dev) — update `CLIENT_URL` when the frontend's deployed origin changes.

## Limitations

- **In-memory jobs are temporary and are not persistent across server restarts.** Completed/failed jobs are kept for ~30 minutes (long enough to review and grade), then cleaned up automatically; this is acceptable for the assignment's explicit "no database required" scope.
- Handwriting quality directly affects OCR/extraction accuracy — messy handwriting can produce lower-confidence or missing labels.
- Bounding-box precision depends entirely on the vision model's own spatial estimate; boxes are validated and clamped to `[0,1]` but never fabricated — a genuinely unlocatable answer region is shown as "could not be located precisely" rather than guessed.
- The mapping engine's semantic fallback (for answers with no detected label) uses a real Gemini call when `GEMINI_API` is available, but degrades to a conservative keyword-overlap heuristic if that call fails or the key is unset — it is not true semantic understanding.
- AI grading is a starting point for the teacher, not a final grade — like any AI evaluation, it should be spot-checked, especially for partial-credit and borderline cases.
- PDF rendering (`pdfjs-dist` + `@napi-rs/canvas`) has not been exercised against a large variety of real-world PDFs in this environment; test with your actual question papers/answer sheets before relying on it for a live demo.
- The old `QnASection.jsx` feature's Hugging Face key (`VITE_HUGGINGFACE_API_KEY`) is inherently exposed client-side by that feature's own design (a direct browser-to-Hugging-Face call) — this is pre-existing behavior, unrelated to and not used by the new assessment/grading flow, whose only AI key (`GEMINI_API`) stays server-side at all times.
