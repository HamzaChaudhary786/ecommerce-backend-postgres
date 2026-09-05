import express from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import {
  registerUser,
  loginUser,
  logoutUser,
  getUserProfile,
  verifyEmail,
  resendVerificationEmail,
} from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";

const baseUrl = process.env.FRONTEND_URL;
const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/logout", logoutUser);
router.get("/profile", protect, getUserProfile);
router.get("/verify-email", verifyEmail);
router.post("/resend-verification-email", resendVerificationEmail);

// Google OAuth routes
router.get(
  "/google",
  (req, res, next) => {
    const role = req.query.role || "buyer";
    passport.authenticate("google", {
      scope: ["profile", "email"],
      state: JSON.stringify({ role })
    })(req, res, next);
  }
);

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: `${process.env.FRONTEND_URL || "http://localhost:3000"}/?auth=login` }),
  (req, res) => {
    // Generate JWT so the frontend can authenticate via localStorage (cross-origin)
    const secret = process.env.JWT_SECRET || "default_jwt_secret_fallback_12345";
    const token = jwt.sign({ id: req.user.id }, secret, { expiresIn: "7d" });

    const userRole = req.user.role;
    let redirectPath = "/auth/google/callback";

    // Pass token + destination role so the frontend callback page can redirect properly
    const params = new URLSearchParams({ token, role: userRole });
    res.redirect(`${baseUrl}${redirectPath}?${params.toString()}`);
  }
);

export default router;
