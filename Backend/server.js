require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const session = require("express-session");
const passport = require("passport");
const cookieParser = require("cookie-parser");

require("./utils/passport");

const evaluationRoutes = require("./routes/EvaluationRoute.js");
const marksRoutes = require("./routes/MarksRoute.js");
const authRoutes = require("./routes/authRoutes.js");
const pptRoutes = require("./routes/pptRoutes.js");
const questionPaperRoutes = require("./routes/QuestionPaperRoute.js"); // Phase 1: new, isolated feature
const answerSheetRoutes = require("./routes/AnswerSheetRoute.js"); // Phase 2: new, isolated feature
const mappingRoutes = require("./routes/MappingRoute.js"); // Phase 3: new, isolated feature
const assessmentRoutes = require("./routes/AssessmentRoute.js"); // Phase 4: new, isolated feature
const statusRoutes = require("./routes/StatusRoute.js"); // Phase 4: new, isolated feature
const assessmentPageRoutes = require("./routes/AssessmentPageRoute.js"); // Phase 5: new, isolated feature
const gradingRoutes = require("./routes/GradingRoute.js"); // Phase 6: new, isolated feature

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === "production") {
  console.warn("⚠️  SESSION_SECRET is not set. Using an insecure default — set SESSION_SECRET in production.");
}

const app = express();


app.use(express.json());
app.use(
  cors({
    // Filter out undefined so a missing CLIENT_URL env var doesn't leave
    // a stray `undefined` entry in the allowed-origins list.
    origin: [process.env.CLIENT_URL, "http://localhost:5173"].filter(Boolean),
    credentials: true,
  })
);
app.use(cookieParser());

app.use(
  session({
    // A hardcoded fallback secret is not safe for a real deployment —
    // require SESSION_SECRET in production, but keep a local-dev
    // fallback so `npm run dev` still works without extra setup.
    secret: process.env.SESSION_SECRET || "dev-only-insecure-session-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);

app.use(passport.initialize());
app.use(passport.session());

const mongoUri = process.env.MONGO_URI?.trim();

if (mongoUri) {
  mongoose
    .connect(mongoUri)
    .then(() => {
      console.log("MongoDB Connected");
    })
    .catch((err) => {
      console.error("MongoDB Connection Error:", err.message);
    });
} else {
  console.log(
    "MongoDB is not configured — database-backed old features are disabled. Assessment APIs do not require MongoDB."
  );
}

app.use("/api/evaluations", evaluationRoutes);
app.use("/api/data", marksRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/ppt", pptRoutes);
app.use("/api/question-paper", questionPaperRoutes); // Phase 1: new, isolated feature
app.use("/api/answer-sheet", answerSheetRoutes); // Phase 2: new, isolated feature
app.use("/api/map-answers", mappingRoutes); // Phase 3: new, isolated feature
app.use("/api/assessment", assessmentRoutes); // Phase 4: new, isolated feature (POST /process)
app.use("/api/assessment/status", statusRoutes); // Phase 4: new, isolated feature (GET /:jobId)
app.use("/api/assessment", assessmentPageRoutes); // Phase 5: new, isolated feature (GET /:jobId/page/:pageNumber)
app.use("/api/assessment", gradingRoutes); // Phase 6: new, isolated feature (POST /:jobId/grade)

// Catch-all 404 for unknown API routes (avoids Express's default HTML
// 404 page, which isn't useful to an API client).
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Not found." });
});

// Final safety-net error handler. Anything thrown/passed to next(err)
// that individual routes didn't already handle lands here — this
// guarantees a stack trace, env var, or internal detail is NEVER sent
// to the client, no matter which route or middleware it came from
// (Express's own default handler includes err.stack in the response
// outside production, which this deliberately overrides everywhere).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("🚨 Unhandled error:", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ success: false, error: "Internal Server Error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
});