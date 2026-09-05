import express from "express";
const feedbackRouter = express.Router();
import * as feedbackController from "../controllers/feedbackController.js";
import { protect, restrictTo } from "../middleware/auth.js";

feedbackRouter.get("/user/:userId", feedbackController.getUserFeedback);

feedbackRouter.use(protect);
feedbackRouter.post("/", feedbackController.leaveFeedback);
feedbackRouter.patch("/:id/reply", feedbackController.replyToFeedback);
feedbackRouter.patch("/:id/report", feedbackController.reportFeedback);
feedbackRouter.patch("/:id/remove", restrictTo("admin"), feedbackController.removeFeedback);

export default feedbackRouter;