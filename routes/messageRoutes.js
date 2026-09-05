import express from "express";
import {
  getConversations,
  getMessages,
  sendMessage,
  markMessagesAsRead,
  editMessage,
  deleteMessage,
} from "../controllers/messageController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

// Apply auth middleware to all message routes
router.use(protect);

router.route("/conversations").get(getConversations);
router.route("/conversations/:id/messages").get(getMessages);
router.route("/messages/:id").patch(editMessage).delete(deleteMessage);
router.route("/").post(sendMessage);
router.route("/read/:conversationId").put(markMessagesAsRead);

export default router;
