import express from "express";
const router = express.Router();
import * as orderController from "../controllers/orderController.js";
import { getItemTracking } from "../controllers/orderController.js";
import { protect, restrictTo } from "../middleware/auth.js";

router.use(protect);

// ─── Buyer Routes ─────────────────────────────────────────────────────────────
router.post("/", orderController.createOrder);
router.get("/my-orders", orderController.getMyOrders);
router.get("/:id", orderController.getOrder);
router.get("/:orderId/items/:itemId/tracking", getItemTracking); // ✅ GPS / courier tracking
router.patch("/:id/address", orderController.updateOrderAddress);
router.patch("/:id/cancel", orderController.cancelOrder);
router.patch("/:orderId/items/:itemId/return", orderController.requestReturn);

// ─── Seller Routes ────────────────────────────────────────────────────────────
router.get("/seller/orders", orderController.getSellerOrders);
router.get("/seller/return-requests", orderController.getSellerReturnRequests);
router.patch("/:orderId/items/:itemId/cancel", orderController.cancelOrderItem);
router.patch("/:orderId/items/:itemId/status", orderController.updateOrderItemStatus);
router.patch("/:orderId/status", orderController.updateFullOrderStatus);
router.patch("/:orderId/live-location", orderController.updateLiveLocation);

router.patch("/:orderId/items/:itemId/confirm-return", orderController.confirmReturnReceived);

// ─── Admin Routes ─────────────────────────────────────────────────────────────
router.get("/", restrictTo("admin"), orderController.getAllOrders);
router.get("/admin/return-requests", restrictTo("admin"), orderController.getReturnRequests);
router.patch("/:orderId/items/:itemId/return-status", restrictTo("admin"), orderController.updateReturnStatus);
router.patch("/:orderId/items/:itemId/complete-refund", restrictTo("admin"), orderController.completeRefund);

export default router;
