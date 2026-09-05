import express from "express";
const router = express.Router();
import * as bidController from "../controllers/bidController.js";
import { protect } from "../middleware/auth.js";

// ─── Public ───────────────────────────────────────────────────────────────────
router.get("/listing/:listingId", bidController.getListingBids);

// ─── Protected ────────────────────────────────────────────────────────────────
router.use(protect);

router.post("/", bidController.placeBid);
router.get("/my-bids", bidController.getMyBids);
router.patch("/:id/retract", bidController.retractBid);

export default router;