import express from "express";
import { protect, restrictTo } from "../middleware/auth.js";
import {
    getPendingStores,
    getAllStores,
    approveStore,
    deleteStore,
    getPendingListings,
    approveListing,
    getSystemMetrics,
    verifySellerInfo,
    verifyBusinessInfo,
    getAdminNotificationSummary,
    getPendingDeals,
    getApprovedDeals,
    approveDeal,
    rejectDeal,
    approveSendEmailDeal,
    sendEmailDeal,
    getPendingFlashSales,
    approveFlashSale,
    rejectFlashSale,
    approveSendEmailFlashSale,
    sendEmailFlashSale,
    testSmtpConnection,
    getApprovedListings,
} from "../controllers/adminController.js";

const router = express.Router();

// 🔒 All routes here are restricted to logged-in admins
router.use(protect, restrictTo("admin", "subadmin"));

// Store Approvals & Management
router.route("/stores/pending").get(getPendingStores); // Specific route first
router.route("/stores").get(getAllStores);
router.route("/stores/:id/approve").patch(approveStore);
router.route("/stores/:id/verify-info").patch(verifySellerInfo);
router.route("/stores/:id/verify-business-info").patch(verifyBusinessInfo);
router.route("/stores/:id").delete(deleteStore);

// Listing Approvals
router.route("/listings/pending").get(getPendingListings);
router.route("/listings/approved").get(getApprovedListings);
router.route("/listings/:id/approve").patch(approveListing);

// System Metrics
router.route("/metrics").get(getSystemMetrics);

// Admin Notification Summary
router.route("/notifications/summary").get(getAdminNotificationSummary);

// Deals Approval & Emailing
router.route("/deals/pending").get(getPendingDeals);
router.route("/deals/approved").get(getApprovedDeals);
router.route("/deals/:id/approve").patch(approveDeal);
router.route("/deals/:id/reject").patch(rejectDeal);
router.route("/deals/:id/approve-send-email").patch(approveSendEmailDeal);
router.route("/deals/:id/send-email").post(sendEmailDeal);

// Flash Sales Approval & Emailing
router.route("/flash-sales/pending").get(getPendingFlashSales);
router.route("/flash-sales/:id/approve").patch(approveFlashSale);
router.route("/flash-sales/:id/reject").patch(rejectFlashSale);
router.route("/flash-sales/:id/approve-send-email").patch(approveSendEmailFlashSale);
router.route("/flash-sales/:id/send-email").post(sendEmailFlashSale);

// SMTP Testing
router.route("/test-smtp").post(testSmtpConnection);

export default router;
