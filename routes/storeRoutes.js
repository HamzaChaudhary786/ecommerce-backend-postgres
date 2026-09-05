import express from "express";
const router = express.Router();
import * as storeController from "../controllers/storeController.js";
import { protect, sellerOnly, optionalAuth } from "../middleware/auth.js";

// Authenticated & Seller only (static routes first)
router.use("/seller", protect, sellerOnly);
router.get("/seller/my-store", storeController.getMyStore);
router.patch("/seller/my-store", storeController.updateStore);
router.get("/seller/stats", storeController.getSellerStats);
router.post("/seller/send-otp", storeController.sendOtp);
router.post("/seller/verify-otp", storeController.verifyOtp);

// Authenticated (general)
router.get("/user/followed", protect, storeController.getFollowedStores);
router.post("/", protect, sellerOnly, storeController.createStore);
router.post("/:storeId/follow", protect, storeController.toggleFollow);

// Public (parameterized routes last)
router.get("/manufacturers", optionalAuth, storeController.getManufacturers);
router.get("/", optionalAuth, storeController.getManufacturers);
router.get("/:slug", optionalAuth, storeController.getStoreBySlug);
router.post("/:slug/view", optionalAuth, storeController.incrementStoreView);
router.get("/:storeId/listings", optionalAuth, storeController.getStoreListings);

export default router;