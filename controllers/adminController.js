import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";
import prisma from "../config/db.js";
import { sendMarketingEmail, isSmtpConfigured } from "../utils/emailService.js";

// GET /api/admin/stores/pending
export const getPendingStores = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = { status: "pending" };
  
  if (req.query.sellerType && req.query.sellerType !== "All") {
    where.seller = {
      businessType: req.query.sellerType
    };
  }

  const [stores, total] = await Promise.all([
    prisma.sellerStore.findMany({ where, include: { seller: { select: { username: true, email: true, name: true, businessType: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.sellerStore.count({ where }),
  ]);
  sendSuccess(res, 200, "Pending stores fetched.", { data: { stores, total, page, pages: Math.ceil(total / limit) } });
});

// PATCH /api/admin/stores/:id/approve
export const approveStore = catchAsync(async (req, res, next) => {
  const { status } = req.body;
  if (!["approved", "rejected"].includes(status)) return next(new AppError("Invalid approval status", 400));

  const store = await prisma.sellerStore.update({
    where: { id: req.params.id },
    data: { status, isVerified: status === "approved" },
  }).catch(() => null);
  if (!store) return next(new AppError("Store not found.", 404));

  if (status === "approved") {
    await prisma.user.update({ where: { id: store.sellerId }, data: { role: "seller" } });
    await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: store.sellerId, type: "system", title: "Store Approved!", message: `Congratulations! Your store "${store.storeName}" has been approved.`, link: "/seller" } });
  } else {
    await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: store.sellerId, type: "system", title: "Store Request Rejected", message: `Your request for "${store.storeName}" was not approved at this time.`, link: "/seller/store" } });
  }
  sendSuccess(res, 200, `Store ${status} successfully.`, { data: { store } });
});

// PATCH /api/admin/stores/:id/verify-info
export const verifySellerInfo = catchAsync(async (req, res, next) => {
  const existing = await prisma.sellerStore.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Store not found.", 404));
  if (!existing.verificationData) return next(new AppError("No verification data found.", 400));

  const verificationData = { ...(existing.verificationData || {}), status: "verified" };
  const store = await prisma.sellerStore.update({ where: { id: req.params.id }, data: { verificationData } });
  await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: store.sellerId, type: "system", title: "Identity Verified!", message: `Your identity for "${store.storeName}" has been approved.`, link: "/seller/store" } });
  sendSuccess(res, 200, "Seller identity verified.", { data: { store } });
});

// PATCH /api/admin/stores/:id/verify-business-info
export const verifyBusinessInfo = catchAsync(async (req, res, next) => {
  const existingStore = await prisma.sellerStore.findUnique({ where: { id: req.params.id } });
  if (!existingStore) return next(new AppError("Store not found.", 404));

  const businessVerification = await prisma.businessVerification.findUnique({ where: { userId: existingStore.sellerId } });
  if (!businessVerification) return next(new AppError("No business verification data found.", 400));

  const updatedBusinessVerification = await prisma.businessVerification.update({
    where: { userId: existingStore.sellerId },
    data: { verificationStatus: "APPROVED" }
  });

  await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined, 
      userId: existingStore.sellerId,
      type: "system",
      title: "Business Verified!",
      message: `Your business details for "${existingStore.storeName}" have been approved.`,
      link: "/seller/store"
    }
  });

  sendSuccess(res, 200, "Business identity verified.", { data: { businessVerification: updatedBusinessVerification } });
});

// GET /api/admin/listings/pending
export const getPendingListings = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {
    status: "pending_approval",
    isDealOfTheDay: false,
    flashSales: {
      none: {} // Exclude listings that have associated flash sales
    }
  };
  const [listings, total] = await Promise.all([
    prisma.listing.findMany({ where, include: { seller: { select: { username: true, email: true, name: true, store: { select: { storeName: true } } } }, category: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.listing.count({ where }),
  ]);
  sendSuccess(res, 200, "Pending listings fetched.", { data: { listings, total, page, pages: Math.ceil(total / limit) } });
});

// GET /api/admin/listings/approved
export const getApprovedListings = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {
    status: "active",
    isDealOfTheDay: false,
    flashSales: {
      none: {} 
    }
  };
  const [listings, total] = await Promise.all([
    prisma.listing.findMany({ where, include: { seller: { select: { username: true, email: true, name: true, store: { select: { storeName: true } } } }, category: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.listing.count({ where }),
  ]);
  sendSuccess(res, 200, "Approved listings fetched.", { data: { listings, total, page, pages: Math.ceil(total / limit) } });
});

// PATCH /api/admin/listings/:id/approve
export const approveListing = catchAsync(async (req, res, next) => {
  const { status, promote } = req.body;
  if (!["active", "rejected"].includes(status)) return next(new AppError("Invalid listing approval status", 400));

  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) return next(new AppError("Listing not found.", 404));

  const updateData = { status };
  
  if (promote) {
    updateData.isFeatured = true;
    updateData.isDealOfTheDay = true;
    updateData.dealStatus = "approved";
  }

  if (status === "active") {
    updateData.startTime = new Date();
    if (listing.listingType === "fixed_price") {
      updateData.endTime = new Date(Date.now() + (listing.duration || 30) * 24 * 60 * 60 * 1000);
    } else {
      updateData.auctionStartTime = new Date();
      updateData.auctionEndTime = new Date(Date.now() + (listing.duration || 7) * 24 * 60 * 60 * 1000);
      updateData.endTime = updateData.auctionEndTime;
    }
  }
  const updated = await prisma.listing.update({ where: { id: req.params.id }, data: updateData });
  sendSuccess(res, 200, `Listing ${status} successfully.`, { data: { listing: updated } });
});

// GET /api/admin/deals/pending
export const getPendingDeals = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = { isDealOfTheDay: true, dealStatus: "pending" };
  const [deals, total] = await Promise.all([
    prisma.listing.findMany({ where, include: { seller: { select: { username: true, email: true, name: true, store: { select: { storeName: true } } } }, category: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.listing.count({ where }),
  ]);
  sendSuccess(res, 200, "Pending deals fetched.", { data: { deals, total, page, pages: Math.ceil(total / limit) } });
});

// GET /api/admin/deals/approved
export const getApprovedDeals = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = { isDealOfTheDay: true, dealStatus: "approved" };
  const [deals, total] = await Promise.all([
    prisma.listing.findMany({ where, include: { seller: { select: { username: true, email: true, name: true, store: { select: { storeName: true } } } }, category: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.listing.count({ where }),
  ]);
  sendSuccess(res, 200, "Approved deals fetched.", { data: { deals, total, page, pages: Math.ceil(total / limit) } });
});

// PATCH /api/admin/deals/:id/approve
export const approveDeal = catchAsync(async (req, res, next) => {
  const { promote } = req.body;
  const deal = await prisma.listing.update({
    where: { id: req.params.id },
    data: {
      dealStatus: "approved",
      status: "active",
      isFeatured: promote === true || promote === "true" ? true : false,
    }
  }).catch(() => null);
  if (!deal) return next(new AppError("Deal not found.", 404));
  sendSuccess(res, 200, "Deal approved successfully.", { data: { deal } });
});

// PATCH /api/admin/deals/:id/reject
export const rejectDeal = catchAsync(async (req, res, next) => {
  const deal = await prisma.listing.update({
    where: { id: req.params.id },
    data: { dealStatus: "rejected", isDealOfTheDay: false }
  }).catch(() => null);
  if (!deal) return next(new AppError("Deal not found.", 404));
  sendSuccess(res, 200, "Deal rejected successfully.", { data: { deal } });
});

// PATCH /api/admin/deals/:id/approve-send-email
export const approveSendEmailDeal = catchAsync(async (req, res, next) => {
  console.log(`[ADMIN] 🚀 "Approve & Blast Email" button clicked for deal ID: ${req.params.id}`);
  console.log(`[ADMIN] 🔌 Calling Approve & Blast API...`);

  const { promote } = req.body;
  const deal = await prisma.listing.update({
    where: { id: req.params.id },
    data: {
      dealStatus: "approved",
      status: "active",
      isFeatured: promote === true || promote === "true" ? true : false,
    }
  }).catch(() => null);

  if (!deal) {
    console.error(`[ADMIN] ❌ Deal not found for ID: ${req.params.id}`);
    return next(new AppError("Deal not found.", 404));
  }

  console.log(`[ADMIN] ✅ Deal approved: "${deal.title}"`);
  console.log(`[ADMIN] 📧 Initiating email blast...`);

  try {
    const result = await sendMarketingEmail(deal.id, "deal", []);

    let message = `Deal approved and email blast sent to ${result.sentCount} buyers.`;
    let emailSuccess = true;

    if (result.error) {
      message = `Deal approved. Email failed: ${result.error}`;
      emailSuccess = false;
    } else if (result.smtpConfigured === false) {
      message = "Deal approved. Email not sent: SMTP credentials missing.";
      emailSuccess = false;
    } else if (result.failedCount > 0) {
      message = `Partial success: ${result.sentCount} sent, ${result.failedCount} failed.`;
      emailSuccess = result.sentCount > 0;
    }

    res.status(200).json({
      success: true,
      dealApproved: true,
      emailSuccess,
      message,
      data: {
        deal,
        totalBuyers: result.total,
        sentCount: result.sentCount,
        failedCount: result.failedCount,
        failedEmails: result.failedEmails,
        smtpConfigured: result.smtpConfigured !== false,
        error: result.error
      }
    });

  } catch (emailErr) {
    console.error("[ADMIN] 💥 Email blast system error:", emailErr.message);
    res.status(200).json({
      success: true,
      dealApproved: true,
      message: `Deal approved, but email system encountered an error: ${emailErr.message}`,
      data: { deal, emailResult: null }
    });
  }
});

// POST /api/admin/deals/:id/send-email
export const sendEmailDeal = catchAsync(async (req, res, next) => {
  console.log(`[ADMIN] 🚀 Resend Email triggered for deal ID: ${req.params.id}`);
  const deal = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!deal || deal.dealStatus !== "approved") {
    console.error(`[ADMIN] ❌ Deal not found or not approved for ID: ${req.params.id}`);
    return next(new AppError("Deal not found or not approved.", 404));
  }

  const result = await sendMarketingEmail(deal.id, "deal", []);

  console.log(`[ADMIN] 📤 Result: ${result.sentCount} sent, ${result.failedCount} failed.`);

  res.status(200).json({
    success: true,
    message: `Resend attempt complete. ${result.sentCount} sent, ${result.failedCount} failed.`,
    data: {
      totalBuyers: result.total,
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      failedEmails: result.failedEmails
    }
  });
});

// GET /api/admin/flash-sales/pending
export const getPendingFlashSales = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = { status: "pending" };
  const [flashSales, total] = await Promise.all([
    prisma.flashSale.findMany({ where, include: { listing: { include: { category: { select: { name: true } } } }, seller: { select: { username: true, email: true, name: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.flashSale.count({ where }),
  ]);
  sendSuccess(res, 200, "Pending flash sales fetched.", { data: { flashSales, total, page, pages: Math.ceil(total / limit) } });
});

// PATCH /api/admin/flash-sales/:id/approve
export const approveFlashSale = catchAsync(async (req, res, next) => {
  const flashSale = await prisma.flashSale.update({
    where: { id: req.params.id },
    data: { status: "approved" }
  }).catch(() => null);
  if (!flashSale) return next(new AppError("Flash sale not found.", 404));
  sendSuccess(res, 200, "Flash sale approved successfully.", { data: { flashSale } });
});

// PATCH /api/admin/flash-sales/:id/reject
export const rejectFlashSale = catchAsync(async (req, res, next) => {
  const flashSale = await prisma.flashSale.update({
    where: { id: req.params.id },
    data: { status: "rejected" }
  }).catch(() => null);
  if (!flashSale) return next(new AppError("Flash sale not found.", 404));
  sendSuccess(res, 200, "Flash sale rejected successfully.", { data: { flashSale } });
});

// PATCH /api/admin/flash-sales/:id/approve-send-email
export const approveSendEmailFlashSale = catchAsync(async (req, res, next) => {
  console.log(`[ADMIN] 🚀 "Approve & Blast Email" for flash sale clicked: ${req.params.id}`);

  const flashSale = await prisma.flashSale.update({
    where: { id: req.params.id },
    data: { status: "approved" }
  }).catch(() => null);

  if (!flashSale) return next(new AppError("Flash sale not found.", 404));

  console.log(`[ADMIN] ✅ Flash Sale approved: ID ${flashSale.id}`);

  try {
    const result = await sendMarketingEmail(flashSale.id, "flash_sale", []);

    let message = `Flash sale approved and email blast sent to ${result.sentCount} buyers.`;
    let emailSuccess = true;

    if (result.error) {
      message = `Flash sale approved. Email failed: ${result.error}`;
      emailSuccess = false;
    } else if (result.smtpConfigured === false) {
      message = "Flash sale approved. Email not sent: SMTP credentials missing.";
      emailSuccess = false;
    } else if (result.failedCount > 0) {
      message = `Partial success: ${result.sentCount} sent, ${result.failedCount} failed.`;
      emailSuccess = result.sentCount > 0;
    }

    res.status(200).json({
      success: true,
      flashSaleApproved: true,
      emailSuccess,
      message,
      data: {
        flashSale,
        totalBuyers: result.total,
        sentCount: result.sentCount,
        failedCount: result.failedCount,
        failedEmails: result.failedEmails,
        smtpConfigured: result.smtpConfigured !== false,
        error: result.error
      }
    });

  } catch (emailErr) {
    console.error("[ADMIN] 💥 Flash Sale email blast failed:", emailErr.message);
    res.status(200).json({
      success: true,
      flashSaleApproved: true,
      message: `Flash sale approved, but email system encountered an error: ${emailErr.message}`,
      data: { flashSale, emailResult: null }
    });
  }
});

// POST /api/admin/flash-sales/:id/send-email
export const sendEmailFlashSale = catchAsync(async (req, res, next) => {
  console.log(`[ADMIN] 🚀 Resend Flash Sale Email triggered: ${req.params.id}`);
  const flashSale = await prisma.flashSale.findUnique({ where: { id: req.params.id } });
  if (!flashSale || flashSale.status !== "approved") {
    console.error(`[ADMIN] ❌ Flash sale not found or not approved: ${req.params.id}`);
    return next(new AppError("Flash sale not found or not approved.", 404));
  }

  const result = await sendMarketingEmail(flashSale.id, "flash_sale", []);

  res.status(200).json({
    success: true,
    message: `Flash sale email blast complete. ${result.sentCount} sent, ${result.failedCount} failed.`,
    data: {
      totalBuyers: result.total,
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      failedEmails: result.failedEmails
    }
  });
});

// GET /api/admin/stores
export const getAllStores = catchAsync(async (req, res) => {
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.search) {
    where.OR = [{ storeName: { contains: req.query.search, mode: "insensitive" } }, { storeSlug: { contains: req.query.search, mode: "insensitive" } }];
  }

  const stores = await prisma.sellerStore.findMany({
    where,
    include: { seller: { select: { id: true, name: true, username: true, email: true, avatar: true, isSuspended: true, businessType: true, listings: { select: { id: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  const enriched = stores.map((s) => ({ ...s, listingCount: s.seller?.listings?.length || 0 }));
  sendSuccess(res, 200, "All stores fetched.", { data: { stores: enriched, total: enriched.length } });
});

// DELETE /api/admin/stores/:id
export const deleteStore = catchAsync(async (req, res, next) => {
  const store = await prisma.sellerStore.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!store) return next(new AppError("Store not found.", 404));
  await prisma.user.update({ where: { id: store.sellerId }, data: { registeredSeller: false } });
  sendSuccess(res, 200, "Store deleted successfully.");
});

// GET /api/admin/metrics
export const getSystemMetrics = catchAsync(async (req, res) => {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const [totalUsers, totalStores, activeListings] = await Promise.all([
    prisma.user.count(),
    prisma.sellerStore.count({ where: { status: "approved" } }),
    prisma.listing.count({ where: { status: "active" } }),
  ]);

  // Revenue from paid orders (only sum successful payments with valid amounts)
  const payments = await prisma.payment.findMany({
    where: { status: "succeeded" },
    select: { amount: true }
  });
  const totalRevenue = payments.reduce((s, p) => s + (p.amount || 0), 0);

  // Seller registrations per month (ensure createdAt is a valid date)
  const recentStores = await prisma.sellerStore.findMany({
    where: { createdAt: { gte: sixMonthsAgo } },
    select: { createdAt: true }
  });
  const monthMap = {};
  recentStores.forEach((s) => {
    if (s.createdAt && s.createdAt instanceof Date && !isNaN(s.createdAt)) {
      const m = s.createdAt.toISOString().slice(0, 7);
      monthMap[m] = (monthMap[m] || 0) + 1;
    }
  });
  const sellerRegistrations = Object.entries(monthMap)
    .sort()
    .map(([month, count]) => ({ month, count }));

  // Top 10 sellers by listing count (handle cases where seller might not have a store)
  const topSellers = await prisma.listing.groupBy({
    by: ["sellerId"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 10
  });

  const productsPerSeller = await Promise.all(
    topSellers.map(async (s) => {
      if (!s.sellerId) return null;
      const store = await prisma.sellerStore.findUnique({
        where: { sellerId: s.sellerId },
        select: { storeName: true }
      });
      return {
        name: store?.storeName || `Seller (${s.sellerId.slice(0, 8)})`,
        count: Number(s._count.id)
      };
    })
  );

  sendSuccess(res, 200, "System metrics fetched.", {
    data: {
      totalUsers,
      totalStores,
      activeListings,
      totalRevenue,
      sellerRegistrations,
      productsPerSeller: productsPerSeller.filter(Boolean)
    }
  });
});



// GET /api/admin/notifications/summary
export const getAdminNotificationSummary = catchAsync(async (req, res) => {
  const [
    pendingStores,
    pendingListings,
    pendingReviews,
    pendingReturns,
    pendingFlashSales,
    pendingPayments,
  ] = await Promise.all([
    // Stores awaiting approval
    prisma.sellerStore.count({ where: { status: "pending" } }),
    // Listings awaiting approval (excluding those already linked to a flash sale request)
    prisma.listing.count({ where: { status: "pending_approval", flashSales: { none: {} } } }),
    // Reviews awaiting moderation
    prisma.review.count({ where: { status: "pending" } }),
    // Return requests pending admin decision
    prisma.orderItem.count({ where: { returnStatus: "pending" } }),
    // Flash sales awaiting admin review
    prisma.flashSale.count({ where: { status: "pending" } }),
    // Payments needing attention (e.g. failed/pending)
    prisma.payment.count({ where: { status: { in: ["pending", "failed"] } } }),
  ]);

  const total = pendingStores + pendingListings + pendingReviews + pendingReturns + pendingFlashSales + pendingPayments;

  const notifications = [];

  if (pendingStores > 0)
    notifications.push({ type: "store", count: pendingStores, label: `${pendingStores} store${pendingStores > 1 ? "s" : ""} awaiting approval`, link: "/admin/store-approval", icon: "store", color: "violet" });

  if (pendingListings > 0)
    notifications.push({ type: "listing", count: pendingListings, label: `${pendingListings} listing${pendingListings > 1 ? "s" : ""} pending review`, link: "/admin/listing-approval", icon: "listing", color: "blue" });

  if (pendingReviews > 0)
    notifications.push({ type: "review", count: pendingReviews, label: `${pendingReviews} review${pendingReviews > 1 ? "s" : ""} need moderation`, link: "/admin/reviews", icon: "review", color: "amber" });

  if (pendingReturns > 0)
    notifications.push({ type: "return", count: pendingReturns, label: `${pendingReturns} return request${pendingReturns > 1 ? "s" : ""} pending`, link: "/admin/returns", icon: "return", color: "rose" });

  if (pendingFlashSales > 0)
    notifications.push({ type: "flashsale", count: pendingFlashSales, label: `${pendingFlashSales} flash sale${pendingFlashSales > 1 ? "s" : ""} to approve`, link: "/admin/flash-sales", icon: "flashsale", color: "orange" });

  if (pendingPayments > 0)
    notifications.push({ type: "payment", count: pendingPayments, label: `${pendingPayments} payment${pendingPayments > 1 ? "s" : ""} require attention`, link: "/admin/payment", icon: "payment", color: "emerald" });

  sendSuccess(res, 200, "Notification summary fetched.", {
    data: { notifications, total },
  });
});

// @desc    Test SMTP Connection
// @route   POST /api/admin/test-smtp
export const testSmtpConnection = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  const targetEmail = email || "ayeshakhadam2@gmail.com";

  console.log(`[ADMIN] 🧪 SMTP Connectivity Test requested for: ${targetEmail}`);

  // Fetch a sample listing to use for the test template
  const sampleListing = await prisma.listing.findFirst({
    where: {
      status: "approved",
      dealDiscountPercent: { gt: 0 }
    }
  }) || await prisma.listing.findFirst();

  if (!sampleListing) {
    return next(new AppError("No listings found in database to use for test email.", 404));
  }

  try {
    const result = await sendTestMarketingEmail(sampleListing.id, "deal", targetEmail);

    if (result.error) {
      return res.status(200).json({
        success: false,
        message: result.error,
        smtpConfigured: false,
        data: { result }
      });
    }

    res.status(200).json({
      success: true,
      message: `Test email sent successfully to ${targetEmail}`,
      smtpConfigured: result.smtpConfigured !== false,
      data: {
        sentTo: targetEmail,
        listingUsed: sampleListing.title,
        result
      }
    });
  } catch (err) {
    console.error(`[ADMIN] ❌ SMTP Test failed: ${err.message}`);
    return next(new AppError(`Email sending failed: ${err.message}`, 500));
  }
});