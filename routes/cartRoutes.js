import express from "express";
const router = express.Router();
import * as cartController from "../controllers/cartController.js";
import { protect, optionalAuth } from "../middleware/auth.js";

// ─── Guest + User cart (optionalAuth reads user if logged in) ─────────────────
router.get("/", optionalAuth, cartController.getCart);
router.post("/add", optionalAuth, cartController.addToCart);
router.patch("/items/:itemId", optionalAuth, cartController.updateCartItem);
router.delete("/items/:itemId", optionalAuth, cartController.removeFromCart);
router.patch("/items/:itemId/save-for-later", optionalAuth, cartController.saveForLater);
router.post("/coupon", optionalAuth, cartController.applyCoupon);
router.delete("/coupon", optionalAuth, cartController.removeCoupon);
router.delete("/", optionalAuth, cartController.clearCart);

// ─── Requires login ───────────────────────────────────────────────────────────
router.post("/merge", protect, cartController.mergeCart);

export default router;