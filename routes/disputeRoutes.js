import express from "express";
const router = express.Router();
import * as disputeController from "../controllers/disputeController.js";
import { protect, restrictTo } from "../middleware/auth.js";

router.use(protect);

// ─── Buyer / Seller ───────────────────────────────────────────────────────────
router.post("/", disputeController.openDispute);
router.get("/my-disputes", disputeController.getMyDisputes);
router.get("/:id", disputeController.getDispute);
router.patch("/:id/respond", disputeController.sellerRespond);
router.patch("/:id/escalate", disputeController.escalateDispute);
router.patch("/:id/close", disputeController.closeDispute);

// ─── Admin only ───────────────────────────────────────────────────────────────
router.get("/", restrictTo("admin"), disputeController.getAllDisputes);
router.patch("/:id/resolve", restrictTo("admin"), disputeController.resolveDispute);
router.patch("/:id/assign", restrictTo("admin"), disputeController.assignDispute);

export default router;