import express from "express";
import {
  createInquiry,
  getMyInquiries,
  getSellerInquiries,
  updateInquiryStatus
} from "../controllers/inquiryController.js";
import { protect, restrictTo } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

// Buyer routes
router.post("/", createInquiry);
router.get("/my-inquiries", getMyInquiries);

// Seller routes
router.get("/seller-inquiries", restrictTo("seller", "admin"), getSellerInquiries);
router.patch("/:id/status", restrictTo("seller", "admin"), updateInquiryStatus);

export default router;
