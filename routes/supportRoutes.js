import express from "express";
const router = express.Router();
import * as supportController from "../controllers/supportController.js";
import { protect, restrictTo } from "../middleware/auth.js";

router.use(protect);

// ─── Shared Routes (User + Admin/Sub-Admin) ──────────────────────────────────
router.post("/tickets", supportController.createTicket);
router.get("/tickets", supportController.getAllTickets);

// This must come BEFORE /tickets/:id to avoid conflict
router.get("/tickets/stats", restrictTo("admin", "subadmin"), supportController.getTicketStats);

router.get("/tickets/:id", supportController.getTicket);
router.patch("/tickets/:id", supportController.updateTicket);
router.delete("/tickets/:id", supportController.deleteTicket);

// ─── Shared Reply Route ───────────────────────────────────────────────────
// Authorization check is handled inside the controller (Staff or Owner)
router.patch("/tickets/:id/respond", supportController.respondToTicket);

// ─── Sub-Admin & Admin Routes ────────────────────────────────────────────────
// Restricted to subadmin and admin roles
router.use(restrictTo("admin", "subadmin"));

router.patch("/tickets/:id/responses/:responseId", supportController.editResponse);
router.delete("/tickets/:id/responses/:responseId", supportController.deleteResponse);
router.patch("/tickets/:id/status", supportController.updateStatus);

export default router;
