import prisma from "../config/db.js";
import twilio from "twilio";
import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";

export const createStore = catchAsync(async (req, res, next) => {
  const existing = await prisma.sellerStore.findUnique({ where: { sellerId: req.user.id } });
  if (existing) return next(new AppError("You already have a store.", 400));

  const { storeName, storeSlug, description, tagline, logo, banner, publicLocation, verificationData, businessType, companyInfo, manufacturingInfo, exportInfo, languages, businessCertifications, capabilities, responseTime, onTimeRate, videoTips } = req.body;
  const slugCheck = await prisma.sellerStore.findUnique({ where: { storeSlug: storeSlug?.toLowerCase() } });
  if (slugCheck) return next(new AppError("Store URL is already taken.", 409));

  const store = await prisma.sellerStore.create({ 
    data: { 
      sellerId: req.user.id, 
      storeName, 
      storeSlug: storeSlug?.toLowerCase(), 
      description, 
      tagline,
      logo, 
      banner, 
      publicLocation, 
      verificationData: verificationData ? { ...verificationData, status: "pending" } : undefined,
      companyInfo,
      manufacturingInfo,
      exportInfo,
      languages,
      businessCertifications,
      capabilities,
      responseTime,
      onTimeRate: onTimeRate ? parseFloat(onTimeRate) : null,
      videoTips
    } 
  });
  
  await prisma.user.update({ 
    where: { id: req.user.id }, 
    data: { 
      registeredSeller: true,
      ...(businessType && { businessType })
    } 
  });
  if (verificationData?.address?.country) {
    const { city, postalCode, country } = verificationData.address;
    const existingAddr = await prisma.address.findFirst({ where: { userId: req.user.id } });
    if (!existingAddr) {
      await prisma.address.create({
        data: { userId: req.user.id, city, postalCode, country, isDefault: true }
      });
    } else {
      await prisma.address.update({
        where: { id: existingAddr.id },
        data: { city, postalCode, country }
      });
    }
  }

  sendSuccess(res, 201, "Store created.", { data: { store } });
});

export const getStoreBySlug = catchAsync(async (req, res, next) => {
  const store = await prisma.sellerStore.findUnique({ 
    where: { storeSlug: req.params.slug }, 
    include: { 
      seller: { 
        select: { 
          id: true,
          username: true, 
          avatar: true, 
          feedbackScore: true, 
          positiveFeedbackPercent: true, 
          createdAt: true,
          BusinessVerification: true,
          businessType: true,
          feedbackReceived: {
            select: {
              score: true,
              comment: true,
              createdAt: true,
              reviewer: {
                select: {
                  username: true,
                  avatar: true
                }
              }
            },
            orderBy: { createdAt: "desc" },
            take: 5
          }
        }
      } 
    } 
  });
  if (!store) return next(new AppError("Store not found.", 404));
  const isAdmin = ["admin", "subadmin"].includes(req.user?.role);
  if (!store.isVerified && store.sellerId !== req.user?.id && !isAdmin) return next(new AppError("This store is pending approval.", 403));

  // Add stats to the store object for the frontend
  const followersCount = Array.isArray(store.verificationData?.followers) 
    ? store.verificationData.followers.length 
    : 0;
  
  store.stats = {
    followers: followersCount,
    totalSales: store.totalSales || 0,
    positiveFeedbackPercent: store.seller?.positiveFeedbackPercent || 100
  };

  const listings = await prisma.listing.findMany({ where: { sellerId: store.sellerId, status: "active" }, include: { category: { select: { id: true, name: true, slug: true } } }, orderBy: { createdAt: "desc" }, take: 20 });
  sendSuccess(res, 200, "Store fetched.", { data: { store, listings } });
});

export const getMyStore = catchAsync(async (req, res) => {
  const store = await prisma.sellerStore.findUnique({ where: { sellerId: req.user.id } });
  sendSuccess(res, 200, store ? "Store fetched." : "You don't have a store yet.", { data: { store: store || null } });
});

export const updateStore = catchAsync(async (req, res, next) => {
  const {
    seller, isVerified, level, businessType,
    storeImages, id, sellerId, createdAt, updatedAt,
    totalSales, totalRevenue, stripeConnectedAccountId, stripeOnboardingComplete,
    ...data
  } = req.body;

  // Cast onTimeRate to Float
  if (data.onTimeRate !== undefined && data.onTimeRate !== null && data.onTimeRate !== "") {
    data.onTimeRate = parseFloat(data.onTimeRate);
    if (isNaN(data.onTimeRate)) data.onTimeRate = null;
  } else if (data.onTimeRate === "" || data.onTimeRate === undefined) {
    data.onTimeRate = null;
  }

  // Cast establishedYear to Int
  if (data.establishedYear !== undefined && data.establishedYear !== null && data.establishedYear !== "") {
    data.establishedYear = parseInt(data.establishedYear, 10);
    if (isNaN(data.establishedYear)) data.establishedYear = null;
  } else if (data.establishedYear === "" || data.establishedYear === undefined) {
    data.establishedYear = null;
  }

  // Validate & normalize storeSlug
  if (data.storeSlug) {
    const conflict = await prisma.sellerStore.findFirst({
      where: { storeSlug: data.storeSlug.toLowerCase(), NOT: { sellerId: req.user.id } }
    });
    if (conflict) return next(new AppError("Store URL is already taken.", 409));
    data.storeSlug = data.storeSlug.toLowerCase();
  }

  // Update user's businessType separately (it lives on the User model, not SellerStore)
  if (businessType) {
    await prisma.user.update({ where: { id: req.user.id }, data: { businessType } });
  }

  // Fetch the existing store to safely merge verificationData (preserves followers etc.)
  const existingStore = await prisma.sellerStore.findUnique({ where: { sellerId: req.user.id } });
  if (!existingStore) return next(new AppError("Store not found. Please create your store first.", 404));

  // Build clean payload — only fields that exist in the Prisma SellerStore schema
  const allowedFields = [
    "storeName", "storeSlug", "description", "logo", "banner", "website",
    "returnPolicy", "shippingPolicy", "annualRevenue",
    "capabilities", "certifications", "establishedYear", "factoryImages",
    "factorySize", "staffSize", "responseTime", "onTimeRate", "videoTips",
    "businessCertifications", "companyInfo", "exportInfo", "languages",
    "manufacturingInfo", "tagline"
  ];

  const cleanData = {};
  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      cleanData[key] = data[key];
    }
  }

  // Merge verificationData safely — preserve system fields like followers that the BE stores there
  if (data.verificationData !== undefined) {
    const existing = existingStore.verificationData || {};
    cleanData.verificationData = {
      ...existing,
      ...data.verificationData,
      // Never overwrite followers from the frontend
      followers: existing.followers || [],
    };
  }

  cleanData.status = "pending";
  cleanData.isVerified = false;

  let store;
  try {
    store = await prisma.sellerStore.update({ where: { sellerId: req.user.id }, data: cleanData });
  } catch (err) {
    console.error("❌ Prisma updateStore error code:", err.code);
    console.error("❌ Prisma updateStore error message:", err.message);
    console.error("❌ Prisma updateStore meta:", err.meta);
    if (err.code === "P2025") {
      return next(new AppError("Store not found. Please create your store first.", 404));
    }
    return next(new AppError(err.message || "Failed to update store.", 500));
  }

  try {
    await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined, 
        userId: req.user.id,
        type: "system",
        title: "Store Updated & Pending Review",
        message: "Your store details were updated and have been sent to the admin for re-verification.",
        link: "/seller/store"
      }
    });
  } catch (notifErr) {
    console.error("⚠️ Notification create failed (non-critical):", notifErr.message);
  }

  sendSuccess(res, 200, "Store updated and pending verification.", { data: { store } });
});

export const getFollowedStores = catchAsync(async (req, res, next) => {
  // Simple implementation to return followed stores
  const stores = await prisma.sellerStore.findMany({
    where: {
      verificationData: {
        path: ['followers'],
        array_contains: req.user.id
      }
    },
    include: {
      seller: {
        select: { id: true, username: true, avatar: true, positiveFeedbackPercent: true }
      }
    }
  }).catch(() => []); // Fallback if JSON query fails
  
  sendSuccess(res, 200, "Followed stores fetched.", { data: { stores } });
});

export const toggleFollow = catchAsync(async (req, res, next) => {
  const store = await prisma.sellerStore.findUnique({ where: { id: req.params.storeId } });
  if (!store) return next(new AppError("Store not found.", 404));
  if (store.sellerId === req.user.id) return next(new AppError("You cannot follow your own store.", 400));

  let verificationData = store.verificationData || {};
  let followers = Array.isArray(verificationData.followers) ? [...verificationData.followers] : [];
  
  const index = followers.indexOf(req.user.id);
  const isFollowing = index === -1;
  
  if (isFollowing) {
    followers.push(req.user.id);
  } else {
    followers.splice(index, 1);
  }

  verificationData.followers = followers;

  await prisma.sellerStore.update({
    where: { id: store.id },
    data: { verificationData }
  });

  sendSuccess(res, 200, "Follow toggled.", { data: { isFollowing, followers: followers.length } });
});

export const getStoreListings = catchAsync(async (req, res, next) => {
  const { page, limit, skip } = paginate(req.query);
  const store = await prisma.sellerStore.findFirst({ where: { id: req.params.storeId }, select: { sellerId: true, isVerified: true } });
  if (!store) return next(new AppError("Store not found.", 404));

  const isAdmin = ["admin", "subadmin"].includes(req.user?.role);
  if (!store.isVerified && store.sellerId !== req.user?.id && !isAdmin) return next(new AppError("This store is pending approval.", 403));

  const where = { sellerId: store.sellerId, status: "active" };
  if (req.query.category) where.categoryId = req.query.category;
  if (req.query.condition) where.condition = req.query.condition;
  if (req.query.minPrice || req.query.maxPrice) { where.price = {}; if (req.query.minPrice) where.price.gte = Number(req.query.minPrice); if (req.query.maxPrice) where.price.lte = Number(req.query.maxPrice); }

  const sortMap = { newest: { createdAt: "desc" }, price_asc: { price: "asc" }, price_desc: { price: "desc" }, ending_soon: { auctionEndTime: "asc" } };
  const [listings, total] = await Promise.all([
    prisma.listing.findMany({ where, include: { category: { select: { name: true, slug: true } } }, orderBy: sortMap[req.query.sort] || { createdAt: "desc" }, skip, take: limit }),
    prisma.listing.count({ where }),
  ]);
  sendSuccess(res, 200, "Store listings fetched.", { data: { listings, total, page, pages: Math.ceil(total / limit) } });
});

export const incrementStoreView = catchAsync(async (req, res, next) => {
  const store = await prisma.sellerStore.findUnique({ where: { storeSlug: req.params.slug.toLowerCase() } });
  if (!store) return next(new AppError("Store not found.", 404));
  
  const isAdmin = ["admin", "subadmin"].includes(req.user?.role);
  if (!store.isVerified && store.sellerId !== req.user?.id && !isAdmin) {
    return next(new AppError("This store is pending approval.", 403));
  }
  
  const today = new Date().toISOString().split("T")[0];
  await prisma.storeView.upsert({ where: { storeId_date: { storeId: store.id, date: today } }, create: { storeId: store.id, userId: req.user?.id || null, date: today, views: 1 }, update: { views: { increment: 1 } } });
  sendSuccess(res, 200, "View incremented.");
});

export const getSellerStats = catchAsync(async (req, res) => {
  const store = await prisma.sellerStore.findUnique({ where: { sellerId: req.user.id } });
  const [totalListings, activeListings, totalOrders, pendingOrders, feedback, viewsData] = await Promise.all([
    prisma.listing.count({ where: { sellerId: req.user.id } }),
    prisma.listing.count({ where: { sellerId: req.user.id, status: "active" } }),
    prisma.orderItem.count({ where: { sellerId: req.user.id } }),
    prisma.orderItem.count({ where: { sellerId: req.user.id, itemStatus: { in: ["paid", "processing"] } } }),
    prisma.feedback.findMany({ where: { revieweeId: req.user.id }, select: { score: true } }),
    store ? prisma.storeView.findMany({ where: { storeId: store.id }, orderBy: { date: "desc" }, take: 30, select: { date: true, views: true } }) : Promise.resolve([]),
  ]);

  const items = await prisma.orderItem.findMany({ 
    where: { 
      sellerId: req.user.id, 
      order: { paymentStatus: { in: ["paid", "partially_refunded"] } },
      itemStatus: { notIn: ["refunded", "cancelled"] }
    }, 
    select: { price: true, quantity: true } 
  });
  const totalRevenue = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const positiveCount = feedback.filter((f) => f.score === 1).length;

  sendSuccess(res, 200, "Seller stats fetched.", { data: { totalListings, activeListings, totalOrders, pendingOrders, feedbackScore: feedback.reduce((s, f) => s + f.score, 0), positiveFeedbackPercent: feedback.length > 0 ? Math.round((positiveCount / feedback.length) * 100) : 100, totalRevenue, viewsGraph: viewsData.reverse() } });
});

export const sendOtp = catchAsync(async (req, res, next) => {
  let { phone } = req.body;
  if (!phone) return next(new AppError("Phone number is required.", 400));
  
  // Normalize phone number (remove all non-digits)
  const normalizedPhone = phone.replace(/\D/g, "");
  
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, fromPhone = process.env.TWILIO_PHONE_NUMBER;

  if (sid && token && fromPhone && sid !== "your_twilio_account_sid_here") {
    try { await twilio(sid, token).messages.create({ body: `Your Verification Code is: ${otp}. Do not share this.`, from: fromPhone, to: phone }); }
    catch (err) { 
      console.error("Twilio SMS Error:", err);
      return next(new AppError("Failed to send SMS.", 500)); 
    }
  } else {
    console.log(`[Mock OTP] phone: ${normalizedPhone}, otp: ${otp}`);
  }
  
  global.otpStore = global.otpStore || new Map();
  global.otpStore.set(normalizedPhone, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
  
  sendSuccess(res, 200, `OTP sent to ${phone}.`);
});

export const verifyOtp = catchAsync(async (req, res, next) => {
  let { phone, otp, livePicture } = req.body;
  if (!phone || !otp) return next(new AppError("Phone and OTP are required.", 400));
  if (!livePicture) return next(new AppError("Live picture missing.", 400));
  
  const normalizedPhone = phone.replace(/\D/g, "");
  
  global.otpStore = global.otpStore || new Map();
  const cached = global.otpStore.get(normalizedPhone);
  
  if (!cached) {
    console.warn(`[Verify OTP] No cached OTP for ${normalizedPhone}. Current store keys:`, [...global.otpStore.keys()]);
    return next(new AppError("OTP not requested or expired for this phone number.", 400));
  }
  
  if (Date.now() > cached.expiresAt) { 
    global.otpStore.delete(normalizedPhone); 
    return next(new AppError("OTP has expired.", 400)); 
  }
  
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const bypass = (!sid || sid === "your_twilio_account_sid_here") && otp === "123456";
  
  if (cached.otp !== otp && !bypass) {
    console.warn(`[Verify OTP] Invalid OTP attempt for ${normalizedPhone}. Expected: ${cached.otp}, Received: ${otp}`);
    return next(new AppError("Invalid OTP code.", 400));
  }
  
  global.otpStore.delete(normalizedPhone);
  await prisma.user.update({ where: { id: req.user.id }, data: { phone } });
  
  sendSuccess(res, 200, "Phone verified.", { data: { livePicture } });
});

export const getManufacturers = catchAsync(async (req, res, next) => {
  const { page, limit, skip } = paginate(req.query);

  const where = {};
  if (req.query.categoryName && req.query.categoryName !== "All categories") {
    where.seller = {
      listings: {
        some: {
          category: {
            name: req.query.categoryName
          }
        }
      }
    };
  }

  const [stores, total] = await Promise.all([
    prisma.sellerStore.findMany({
      where,
      include: {
        seller: {
          select: {
            id: true,
            username: true,
            businessType: true,
            positiveFeedbackPercent: true,
            createdAt: true,
            addresses: {
              where: { isDefault: true },
              take: 1
            },
            feedbackReceived: {
              select: { id: true }
            },
            listings: {
              where: { status: "active" },
              take: 3,
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                title: true,
                price: true,
                minPrice: true,
                maxPrice: true,
                images: true,
                moqQuantity: true,
                moqUnit: true,
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.sellerStore.count({ where })
  ]);

  const formattedStores = stores.map(store => {
    const defaultAddress = store.seller?.addresses?.[0];
    const reviewCount = store.seller?.feedbackReceived?.length || 0;
    
    return {
      ...store,
      location: defaultAddress ? `${defaultAddress.state || ''}, ${defaultAddress.country || ''}`.replace(/^, /, '').trim() : null,
      country: defaultAddress?.country || null,
      reviewCount,
      topProducts: store.seller?.listings || []
    };
  });

  sendSuccess(res, 200, "Manufacturers fetched.", { 
    data: { stores: formattedStores, total, page, pages: Math.ceil(total / limit) } 
  });
});