import express from "express";
import {
  getHubs,
  getHub,
  createHub,
  updateHub,
  deleteHub
} from "../controllers/businessHubController.js";
import { protect, restrictTo } from "../middleware/auth.js";

const router = express.Router();

router.route("/")
  .get(getHubs)
  .post(protect, restrictTo("admin"), createHub);

router.route("/:id")
  .get(getHub)
  .put(protect, restrictTo("admin"), updateHub)
  .delete(protect, restrictTo("admin"), deleteHub);

export default router;
