import express from "express";
import {
  submitVerification,
  getMyVerification,
  getAllVerifications,
  updateVerificationStatus
} from "../controllers/businessVerificationController.js";
import { protect, restrictTo } from "../middleware/auth.js";

const router = express.Router();

// Protect all routes
router.use(protect);

// Seller/Buyer Routes
router.post("/submit", submitVerification);
router.get("/me", getMyVerification);

// Admin/Subadmin Routes
router.use(restrictTo("admin", "subadmin"));
router.get("/admin/all", getAllVerifications);
router.patch("/admin/:id/status", updateVerificationStatus);

export default router;
