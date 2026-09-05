import bcrypt from "bcryptjs";
import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";

// @desc   Search users by name/email/username (for messaging)
// @route  GET /api/users/search?q=
export const searchUsers = catchAsync(async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return sendSuccess(res, 200, "Empty query", { users: [] });
  }

  const term = q.trim();
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { firstName: { contains: term, mode: "insensitive" } },
        { lastName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
        { username: { contains: term, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, firstName: true, lastName: true, email: true, avatar: true, role: true, username: true },
    take: 20,
  });

  sendSuccess(res, 200, "Users found", { users });
});

// @desc   Get all users (Admin)
// @route  GET /api/users
export const getUsers = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, firstName: true, lastName: true, username: true, email: true, role: true, avatar: true, isSuspended: true, createdAt: true, registeredSeller: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.user.count(),
  ]);

  sendSuccess(res, 200, "Users fetched.", {
    data: { users, total, page, pages: Math.ceil(total / limit) },
  });
});

// @desc   Get single user
// @route  GET /api/users/:id
export const getUserById = catchAsync(async (req, res, next) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, name: true, firstName: true, lastName: true, username: true,
      email: true, role: true, avatar: true, phone: true, isSuspended: true,
      isVerified: true, registeredSeller: true, sellerLevel: true,
      feedbackScore: true, positiveFeedbackPercent: true,
      totalSales: true, totalPurchases: true, createdAt: true, watchlist: true,
      store: { select: { storeName: true, storeSlug: true, logo: true, status: true, isVerified: true, totalSales: true, totalRevenue: true } },
    },
  });

  if (!user) return next(new AppError("User not found", 404));

  // Dynamically calculate total purchases
  const totalPurchases = await prisma.order.count({
    where: { buyerId: user.id, status: { not: "cancelled" } },
  });
  user.totalPurchases = totalPurchases;

  if ((user.role === "seller" || user.registeredSeller) && user.store) {
    const activeListing = await prisma.listing.count({
      where: { sellerId: user.id, status: "active" },
    });

    // Dynamically calculate total sales and revenue
    const orderItems = await prisma.orderItem.findMany({
      where: { sellerId: user.id, order: { status: { not: "cancelled" } } },
      select: { quantity: true, price: true },
    });

    const totalSales = orderItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalRevenue = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    user.store.stats = {
      activeListing,
      totalSales: totalSales > 0 ? totalSales : (user.store.totalSales || 0),
      totalRevenue: totalRevenue > 0 ? totalRevenue : (user.store.totalRevenue || 0),
    };
  }
  sendSuccess(res, 200, "User fetched.", { data: { user } });
});

// @desc   Create a user (Admin)
// @route  POST /api/users
export const createUser = catchAsync(async (req, res, next) => {
  const { email, password, name, username, role } = req.body;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return next(new AppError("User already exists", 400));

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, password: hashedPassword, name, username, role },
  });
  sendSuccess(res, 201, "User created.", { data: { user } });
});

// @desc   Update a user
// @route  PUT /api/users/:id
export const updateUser = catchAsync(async (req, res, next) => {
  const { password, ...rest } = req.body;

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: rest,
    select: { id: true, name: true, email: true, role: true, avatar: true, isSuspended: true, businessType: true },
  }).catch(() => null);

  if (!user) return next(new AppError("User not found", 404));
  sendSuccess(res, 200, "User updated.", { data: { user } });
});

// @desc   Delete a user
// @route  DELETE /api/users/:id
export const deleteUser = catchAsync(async (req, res, next) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
  } catch {
    return next(new AppError("User not found", 404));
  }
  sendSuccess(res, 200, "User deleted.");
});

// @desc   Toggle Listing in Watchlist
// @route  POST /api/users/watchlist/:id
export const toggleWatchlist = catchAsync(async (req, res, next) => {
  const listingId = req.params.id;
  const userId = req.user.id;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, watchlist: true } });
  if (!user) return next(new AppError("User not found", 404));

  const currentWatchlist = Array.isArray(user?.watchlist) ? user.watchlist.filter(Boolean) : [];
  const isWatched = currentWatchlist.includes(listingId);
  
  const updatedWatchlist = isWatched
    ? currentWatchlist.filter((id) => id !== listingId)
    : [...currentWatchlist, listingId];

  await prisma.user.update({ where: { id: userId }, data: { watchlist: updatedWatchlist } });

  sendSuccess(res, 200, isWatched ? "Removed from watchlist" : "Added to watchlist", {
    data: { isWatched: !isWatched, watchlist: updatedWatchlist },
  });
});

// @desc   Get User Watchlist
// @route  GET /api/users/watchlist
export const getWatchlist = catchAsync(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { watchlist: true },
  });

  const validWatchlist = Array.isArray(user?.watchlist) 
    ? user.watchlist.filter(Boolean) 
    : [];

  const listings = validWatchlist.length > 0
    ? await prisma.listing.findMany({
        where: { id: { in: validWatchlist } },
        select: {
          id: true, title: true, price: true, currentBid: true, startingBid: true,
          images: true, status: true, listingType: true, auctionEndTime: true,
          isB2BProduct: true, minPrice: true, maxPrice: true, moqQuantity: true, moqUnit: true,
          seller: { select: { username: true, name: true, store: { select: { storeName: true, logo: true } } } },
        },
      })
    : [];

  sendSuccess(res, 200, "Watchlist fetched.", { data: { watchlist: listings } });
});

// @desc   Add an address
// @route  POST /api/users/addresses
export const addAddress = catchAsync(async (req, res, next) => {
  const { fullName, phone, street, city, state, postalCode, country, isDefault } = req.body;

  if (isDefault) {
    await prisma.address.updateMany({
      where: { userId: req.user.id },
      data: { isDefault: false },
    });
  }

  const address = await prisma.address.create({
    data: { userId: req.user.id, fullName, phone, street, city, state, postalCode, country, isDefault: isDefault || false },
  });

  const addresses = await prisma.address.findMany({ where: { userId: req.user.id } });
  sendSuccess(res, 201, "Address added.", { data: { addresses } });
});

// @desc   Delete an address
// @route  DELETE /api/users/addresses/:id
export const deleteAddress = catchAsync(async (req, res, next) => {
  try {
    await prisma.address.delete({ where: { id: req.params.id } });
  } catch {
    return next(new AppError("Address not found", 404));
  }
  const addresses = await prisma.address.findMany({ where: { userId: req.user.id } });
  sendSuccess(res, 200, "Address deleted.", { data: { addresses } });
});

// @desc   Get user addresses
// @route  GET /api/users/addresses
export const getAddresses = catchAsync(async (req, res, next) => {
  const addresses = await prisma.address.findMany({ where: { userId: req.user.id } });
  sendSuccess(res, 200, "Addresses fetched.", { data: { addresses } });
});

// @desc   Get manageable users for subadmin
// @route  GET /api/users/subadmin/manage
export const getManageableUsers = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const { role } = req.query;

  // Build role filter: if specific role requested use it, otherwise return both buyers and sellers
  const roleFilter = role && (role === "buyer" || role === "seller")
    ? { role }
    : { role: { in: ["buyer", "seller"] } };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: roleFilter,
      select: { id: true, name: true, email: true, role: true, avatar: true, isSuspended: true, createdAt: true, businessType: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.user.count({ where: roleFilter }),
  ]);

  sendSuccess(res, 200, "Manageable users fetched.", {
    data: { users, total, page, pages: Math.ceil(total / limit) },
  });
});

// @desc   Toggle user block status
// @route  PATCH /api/users/subadmin/manage/:id/block
export const toggleUserBlock = catchAsync(async (req, res, next) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true, isSuspended: true } });

  if (!existing) return next(new AppError("User not found", 404));

  if (existing.role === "admin" || existing.role === "subadmin") {
    return next(new AppError("Cannot block admin level accounts", 403));
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isSuspended: !existing.isSuspended },
    select: { id: true, isSuspended: true },
  });

  sendSuccess(res, 200, `User has been ${user.isSuspended ? "blocked" : "unblocked"} successfully.`, {
    data: { user },
  });
});
