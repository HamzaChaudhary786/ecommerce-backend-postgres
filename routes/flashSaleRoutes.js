import express from "express";
import {
  requestFlashSale,
  reviewFlashSale,
  getFlashSales,
  getActiveFlashSales,
  deleteFlashSale,
  deleteBatchFlashSales,
} from "../controllers/flashSaleController.js";
import { protect, restrictTo } from "../middleware/auth.js";

const router = express.Router();

// Public routes
router.get("/active", getActiveFlashSales);

// Protected routes
router.use(protect);

router.get("/", getFlashSales);

// Seller routes
router.post("/request", restrictTo("seller"), requestFlashSale);
router.delete("/batch", restrictTo("seller"), deleteBatchFlashSales);
router.delete("/:id", restrictTo("seller"), deleteFlashSale);

// Admin routes
router.patch("/batch/review", restrictTo("admin"), reviewFlashSale);
router.patch("/:id/review", restrictTo("admin"), reviewFlashSale);

export default router;
