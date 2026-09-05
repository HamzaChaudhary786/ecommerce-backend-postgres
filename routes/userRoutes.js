import express from "express";
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  searchUsers,
  toggleWatchlist,
  getWatchlist,
  addAddress,
  deleteAddress,
  getAddresses,
  getManageableUsers,
  toggleUserBlock,
} from "../controllers/userController.js";
import { protect, restrictTo } from "../middleware/auth.js";

const router = express.Router();

// SubAdmin User Management Routes
router.get("/subadmin/manage", protect, restrictTo("admin", "subadmin"), getManageableUsers);
router.patch("/subadmin/manage/:id/block", protect, restrictTo("admin", "subadmin"), toggleUserBlock);

// Watchlist
router.get("/watchlist", protect, getWatchlist);
router.post("/watchlist/:id", protect, toggleWatchlist);

// Addresses
router.get("/addresses", protect, getAddresses);
router.post("/addresses", protect, addAddress);
router.delete("/addresses/:id", protect, deleteAddress);

router.get("/search", protect, searchUsers);
router.route("/").get(getUsers).post(createUser);
router.route("/:id").get(getUserById).put(updateUser).delete(deleteUser);

export default router;
