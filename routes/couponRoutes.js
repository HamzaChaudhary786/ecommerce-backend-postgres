import express from "express";
const router = express.Router();
import * as couponController from "../controllers/couponController.js";
import { protect, restrictTo } from "../middleware/auth.js";

// Public — validate at checkout
router.post("/validate", couponController.validateCoupon);
router.get("/seller/:sellerId", couponController.getSellerCoupons);

// Seller routes
router.use(protect);
router.get("/my-coupons", restrictTo("seller"), couponController.getMyCoupons);
router.post("/my-coupons", restrictTo("seller"), couponController.createSellerCoupon);
router.patch("/my-coupons/:id", restrictTo("seller"), couponController.updateSellerCoupon);
router.delete("/my-coupons/:id", restrictTo("seller"), couponController.deleteSellerCoupon);

// Admin only
router.use(restrictTo("admin"));
router.get("/", couponController.getAllCoupons);
router.post("/", couponController.createCoupon);
router.get("/:id", couponController.getCoupon);
router.patch("/:id", couponController.updateCoupon);
router.patch("/:id/toggle", couponController.toggleCoupon);
router.delete("/:id", couponController.deleteCoupon);

export default router;