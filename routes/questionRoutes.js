import express from "express";
import { protect, restrictTo } from "../middleware/auth.js";
import {
  askQuestion,
  answerQuestion,
  getListingQuestions,
  getSellerQuestions,
  deleteQuestion,
} from "../controllers/questionController.js";

const router = express.Router();

// Public routes
router.get("/listing/:listingId", getListingQuestions);

// Protected routes (Buyer/Any)
router.post("/", protect, askQuestion);
router.delete("/:id", protect, deleteQuestion);

// Protected routes (Seller)
router.get("/seller", protect, restrictTo("seller", "admin"), getSellerQuestions);
router.patch("/:id/answer", protect, restrictTo("seller", "admin"), answerQuestion);

export default router;
