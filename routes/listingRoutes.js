import express from "express";
const router = express.Router();
import * as listingController from "../controllers/listingController.js";
import { protect, optionalAuth, sellerOnly, restrictTo } from "../middleware/auth.js";
import upload from "../middleware/uploadMiddleware.js";

// ─── Public Routes ────────────────────────────────────────────────────────────
router.get("/", listingController.getAllListings);
router.get("/featured", listingController.getFeaturedListings);
router.get("/deals-of-the-day", listingController.getDealsOfTheDay);
router.get("/grouped-by-category", listingController.getListingsByCategory);
router.get("/search/suggestions", listingController.getSearchSuggestions);
router.post("/visual-search", listingController.visualSearch);
router.post("/image-search", upload.single("image"), listingController.imageSearch);
router.get("/:id", optionalAuth, listingController.getListing);
router.get("/:id/related", listingController.getRelatedListings);

// ─── Protected Routes ─────────────────────────────────────────────────────────
router.use(protect);

router.get("/user/my-listings", listingController.getMyListings);
router.get("/user/watchlist", listingController.getWatchlist);
router.post("/:id/watch", listingController.toggleWatch);

// ─── Seller Routes ────────────────────────────────────────────────────────────
router.post("/suggest", sellerOnly, upload.single("image"), listingController.suggestProductDetails);
router.post("/", sellerOnly, listingController.createListing);
router.patch("/:id", listingController.updateListing);
router.patch("/:id/publish", listingController.publishListing);
router.patch("/:id/end", listingController.endListing);
router.delete("/batch", sellerOnly, listingController.deleteBatchListings);
router.delete("/:id", listingController.deleteListing);

// ─── Admin Routes ─────────────────────────────────────────────────────────────
router.patch("/:id/suspend", restrictTo("admin"), listingController.suspendListing);
// router.patch("/:id/approve", restrictTo("admin"), listingController.approveListing);
export default router;