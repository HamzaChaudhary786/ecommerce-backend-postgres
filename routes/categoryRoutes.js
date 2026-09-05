import express from "express";
const router = express.Router();
import * as categoryController from "../controllers/categoryController.js";
import { protect, restrictTo } from "../middleware/auth.js";

// ─── Public Routes ────────────────────────────────────────────────────────────
router.get("/", categoryController.getAllCategories);
router.get("/slug/:slug", categoryController.getCategoryBySlug);
router.get("/:id", categoryController.getCategory);
router.get("/:id/breadcrumb", categoryController.getCategoryBreadcrumb);
router.get("/:id/attributes", categoryController.getCategoryAttributes);

// ─── Admin Only ───────────────────────────────────────────────────────────────
router.use(protect, restrictTo("admin"));

router.post("/", categoryController.createCategory);
router.patch("/:id", categoryController.updateCategory);
router.patch("/:id/toggle-active", categoryController.toggleActive);
router.delete("/:id", categoryController.deleteCategory);

export default router;