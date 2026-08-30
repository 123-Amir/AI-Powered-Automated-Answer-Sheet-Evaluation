const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const { isGoogleOAuthConfigured } = require("../utils/passport");
const User = require("../models/User.js");

const router = express.Router();

// Signup
router.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ msg: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    user = new User({ name, email, password: hashedPassword });

    await user.save();
    res.json({ msg: "Signup successful" });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    res
      .cookie("token", token, { httpOnly: true })
      .json({ msg: "Login successful" });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// Google OAuth is optional — see utils/passport.js. When
// GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not set, no "google"
// strategy was ever registered with passport, so this middleware
// returns a clear, safe response instead of letting
// passport.authenticate("google", ...) fail on an unknown strategy.
function requireGoogleOAuthConfigured(req, res, next) {
  if (!isGoogleOAuthConfigured) {
    return res.status(503).json({
      msg: "Google sign-in is not configured on this server.",
      error: "GOOGLE_OAUTH_NOT_CONFIGURED",
    });
  }
  next();
}

// Google OAuth
router.get(
  "/google",
  requireGoogleOAuthConfigured,
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  requireGoogleOAuthConfigured,
  passport.authenticate("google", { session: false }),
  (req, res) => {
    const token = jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    res.cookie("token", token, { httpOnly: true });
    res.redirect(`${process.env.CLIENT_URL}?token=${token}`);
  }
);
module.exports = router