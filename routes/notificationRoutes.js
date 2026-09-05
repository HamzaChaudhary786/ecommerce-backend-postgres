import express from "express";
const router = express.Router();
import * as notificationController from "../controllers/notificationController.js";
import { protect } from "../middleware/auth.js";

router.use(protect);

router.get("/unread-count", notificationController.getUnreadCount);
router.get("/", notificationController.getNotifications);
router.patch("/mark-all-read", notificationController.markAllAsRead);
router.patch("/:id/read", notificationController.markAsRead);
router.delete("/", notificationController.deleteAllNotifications);
router.delete("/:id", notificationController.deleteNotification);

export default router;