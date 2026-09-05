import express from "express";
const router = express.Router();
import * as paymentController from "../controllers/paymentController.js";
import { protect, restrictTo } from "../middleware/auth.js";

router.use(protect);

// ─── Payment Flow ─────────────────────────────────────────────────────────────
router.post("/create-intent", paymentController.createPaymentIntent);
router.post("/confirm", paymentController.confirmPayment);
router.post("/initiate-mobile", paymentController.initiateMobilePayment);
router.get("/history", paymentController.getPaymentHistory);
router.post("/:id/refund", restrictTo("admin"), paymentController.refundPayment);

// ─── Saved Payment Methods ────────────────────────────────────────────────────
router.get("/methods", paymentController.getPaymentMethods);
router.post("/methods", paymentController.addPaymentMethod);
router.delete("/methods/:id", paymentController.deletePaymentMethod);
router.patch("/methods/:id/default", paymentController.setDefaultPaymentMethod);

// ─── Admin ────────────────────────────────────────────────────────────────────
router.get("/", restrictTo("admin"), paymentController.getAllPayments);

// ─── Stripe Connect ───────────────────────────────────────────────────────────
router.get("/connect-stripe", paymentController.createConnectAccount);
router.get("/connect-status", paymentController.getConnectStatus);
router.post("/dev-bypass-onboarding", paymentController.devBypassOnboarding);

export default router;