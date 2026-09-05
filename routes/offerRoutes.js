import express from "express";
const router = express.Router();
import * as offerController from "../controllers/offerController.js";
import { protect } from "../middleware/auth.js";

router.use(protect);

router.post("/", offerController.makeOffer);
router.get("/sent", offerController.getSentOffers);
router.get("/received", offerController.getReceivedOffers);
router.patch("/:id/respond", offerController.respondToOffer);
router.patch("/:id/accept-counter", offerController.acceptCounter);
router.patch("/:id/cancel", offerController.cancelOffer);

export default router;