import express from "express";
import upload from "../middleware/uploadMiddleware.js";
import { protect, restrictTo } from "../middleware/auth.js";
import {
  uploadReviewImage,
  createReview,
  getListingReviews,
  getMyReview,
  updateReview,
  deleteReview,
  voteHelpful,
  adminGetAllReviews,
  adminUpdateReviewStatus,
} from "../controllers/reviewController.js";

const router = express.Router();

// ── Image upload (any logged-in user) ─────────────────────────────────────
router.post(
  "/upload-image",
  protect,
  upload.single("image"),
  uploadReviewImage
);

// ── Per-listing routes ────────────────────────────────────────────────────
router.get("/listing/:listingId", getListingReviews);                      // public
router.get("/listing/:listingId/my-review", protect, getMyReview);        // auth
router.post("/listing/:listingId", protect, createReview);                 // auth + purchased

// ── Single review mutations ───────────────────────────────────────────────
router.patch("/:reviewId", protect, updateReview);                         // owner / admin
router.delete("/:reviewId", protect, deleteReview);                        // owner / admin
router.post("/:reviewId/helpful", protect, voteHelpful);                   // auth

// ── Admin only ────────────────────────────────────────────────────────────
router.get("/admin", protect, restrictTo("admin"), adminGetAllReviews);
router.patch("/admin/:reviewId", protect, restrictTo("admin"), adminUpdateReviewStatus);

export default router;
