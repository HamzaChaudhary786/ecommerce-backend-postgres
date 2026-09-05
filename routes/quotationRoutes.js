import express from "express";
import {
  getSellerQuotations,
  createQuotation,
  getBuyerQuotations,
  updateQuotationStatus
} from "../controllers/quotationController.js";
import { protect, restrictTo } from "../middleware/auth.js";

const router = express.Router();

// Protect all routes
router.use(protect);

// Seller Quotations
router.get("/seller", restrictTo("seller"), getSellerQuotations);
router.post("/seller", restrictTo("seller"), createQuotation);

// Buyer Quotations
router.get("/buyer", restrictTo("buyer"), getBuyerQuotations);
router.patch("/buyer/:id/status", restrictTo("buyer"), updateQuotationStatus);

export default router;
