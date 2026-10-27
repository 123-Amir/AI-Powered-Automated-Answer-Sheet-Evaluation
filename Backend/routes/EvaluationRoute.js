const express = require("express");
const multer = require("multer");
const extractTextFromImage = require("../utils/geminiExtractor");
const Evaluation = require("../models/Evaluation");

const router = express.Router();
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (SUPPORTED_IMAGE_TYPES.includes(file.mimetype)) {
      return cb(null, true);
    }

    const error = new Error(`Unsupported image type "${file.mimetype}".`);
    error.statusCode = 400;
    return cb(error);
  },
});

// ✅ GET route added here for testing
router.get("/", async (req, res) => {
  try {
    const allEvaluations = await Evaluation.find();
    res.status(200).json(allEvaluations);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch evaluations" });
  }
});

router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { referenceAnswers, difficulty } = req.body;
    const imageFile = req.file;

    if (
      !imageFile ||
      !referenceAnswers ||
      referenceAnswers.length === 0 ||
      !difficulty
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const extractedAnswers = await extractTextFromImage(
      imageFile.buffer,
      imageFile.mimetype
    );
    const parsedReferenceAnswers = JSON.parse(referenceAnswers);

    const newEvaluation = new Evaluation({
      referenceAnswers: parsedReferenceAnswers,
      extractedAnswers,
      difficulty,
    });

    await newEvaluation.save();

    res
      .status(201)
      .json({ message: "Evaluation created", id: newEvaluation._id });
  } catch (error) {
    console.error("🚨 Internal Server Error:", error);
    res
      .status(500)
      .json({ error: "Internal Server Error", details: error.message });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? `File too large. Maximum allowed size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`
        : err.message;
    return res.status(400).json({ error: message });
  }

  if (err && err.statusCode === 400) {
    return res.status(400).json({ error: err.message });
  }

  return next(err);
});

module.exports = router;
