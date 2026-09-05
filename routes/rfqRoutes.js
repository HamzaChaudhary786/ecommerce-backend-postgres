import express from 'express';
import * as rfqController from '../controllers/rfqController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import upload from '../middleware/uploadMiddleware.js';

const router = express.Router();

// --- PUBLIC ROUTES ---
router.get('/public', rfqController.getPublicRFQs);
router.get('/public/:id', rfqController.getPublicRFQById);

// --- PROTECTED ROUTES ---
router.use(protect);

// --- BUYER ROUTES ---
// RFQ Management
router.post('/', restrictTo('buyer'), upload.array('attachments', 10), rfqController.createRFQ);
router.get('/my-rfqs', restrictTo('buyer'), rfqController.getMyRFQs);
router.get('/my-rfqs/:id', restrictTo('buyer'), rfqController.getMyRFQById);
router.patch('/:id', restrictTo('buyer'), upload.array('attachments', 10), rfqController.updateRFQ);
router.delete('/:id', restrictTo('buyer'), rfqController.deleteRFQ);

// Analytics
router.get('/analytics/buyer', restrictTo('buyer'), rfqController.getBuyerAnalytics);

// Actions
router.post('/:id/publish', restrictTo('buyer'), rfqController.publishRFQ);
router.post('/:id/close', restrictTo('buyer'), rfqController.closeRFQ);
router.post('/:id/duplicate', restrictTo('buyer'), rfqController.duplicateRFQ);

// Quotation Management (Buyer Side)
router.get('/:id/quotes', restrictTo('buyer'), rfqController.getRFQQuotesForBuyer);
router.post('/quotes/:quoteId/award', restrictTo('buyer'), rfqController.awardQuote);
router.post('/quotes/:quoteId/reject', restrictTo('buyer'), rfqController.rejectQuote);

// Invitations & Blocklist
router.post('/:id/invite', restrictTo('buyer'), rfqController.inviteSupplier);
router.post('/block-supplier', restrictTo('buyer'), rfqController.blockSupplier);

// Templates
router.post('/templates', restrictTo('buyer'), rfqController.saveTemplate);
router.get('/templates', restrictTo('buyer'), rfqController.getTemplates);

// --- SUPPLIER ROUTES ---
// RFQ Feed
router.get('/available', restrictTo('seller'), rfqController.getAvailableRFQs);

// Saved RFQs
router.post('/:id/save', restrictTo('seller'), rfqController.saveRFQ);
router.get('/saved', restrictTo('seller'), rfqController.getSavedRFQs);

// Analytics
router.get('/analytics/supplier', restrictTo('seller'), rfqController.getSupplierAnalytics);

// Quotation Management (Supplier Side)
router.post('/:id/quotes', restrictTo('seller'), upload.array('attachments', 5), rfqController.submitQuote);
router.get('/my-quotes', restrictTo('seller'), rfqController.getMyQuotes);
router.patch('/quotes/:quoteId', restrictTo('seller'), upload.array('attachments', 5), rfqController.updateQuote);
router.post('/quotes/:quoteId/withdraw', restrictTo('seller'), rfqController.withdrawQuote);

// --- NEGOTIATION (Shared) ---
router.get('/quotes/:quoteId/messages', rfqController.getQuoteMessages);
router.post('/quotes/:quoteId/messages', upload.array('attachments', 5), rfqController.sendMessage);

// --- ADMIN ROUTES ---
router.use(restrictTo('admin', 'subadmin'));
router.get('/admin/all', rfqController.getAllRFQsAdmin);
router.get('/admin/analytics', rfqController.getAdminAnalytics);
router.patch('/admin/:id/status', rfqController.updateRFQStatusAdmin);

export default router;
