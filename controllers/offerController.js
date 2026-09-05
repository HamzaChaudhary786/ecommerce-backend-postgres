import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";

// POST /api/offers
export const makeOffer = catchAsync(async (req, res, next) => {
  const { listingId, offerPrice, quantity, message } = req.body;

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) return next(new AppError("Listing not found.", 404));
  if (!listing.isBestOfferEnabled) return next(new AppError("This listing does not accept offers.", 400));
  if (listing.status !== "active") return next(new AppError("Listing is not active.", 400));
  if (listing.sellerId === req.user.id) return next(new AppError("You cannot make an offer on your own listing.", 403));
  if (offerPrice <= 0) return next(new AppError("Offer price must be greater than 0.", 400));

  const existingOffer = await prisma.offer.findFirst({ where: { listingId, buyerId: req.user.id, status: { in: ["pending", "countered"] } } });
  if (existingOffer) return next(new AppError("You already have an active offer on this listing.", 400));

  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const historyEntry = { by: req.user.id, role: "buyer", action: "offer", price: offerPrice, message };

  if (listing.bestOfferAutoAcceptPrice && offerPrice >= listing.bestOfferAutoAcceptPrice) {
    const offer = await prisma.offer.create({ data: { listingId, buyerId: req.user.id, sellerId: listing.sellerId, offerPrice, quantity: quantity || 1, message, status: "accepted", expiresAt, history: [historyEntry] } });
    return sendSuccess(res, 201, "Offer auto-accepted!", { data: { offer } });
  }

  if (listing.bestOfferAutoDeclinePrice && offerPrice <= listing.bestOfferAutoDeclinePrice) {
    const offer = await prisma.offer.create({ data: { listingId, buyerId: req.user.id, sellerId: listing.sellerId, offerPrice, quantity: quantity || 1, message, status: "declined", expiresAt, history: [historyEntry] } });
    return sendSuccess(res, 201, "Offer automatically declined (below minimum).", { data: { offer } });
  }

  const offer = await prisma.offer.create({ data: { listingId, buyerId: req.user.id, sellerId: listing.sellerId, offerPrice, quantity: quantity || 1, message, status: "pending", expiresAt, history: [historyEntry] } });
  await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: listing.sellerId, type: "offer_received", title: "New Offer Received", message: `You received a $${offerPrice} offer on "${listing.title}"`, link: `/seller/offers/${offer.id}` } });

  sendSuccess(res, 201, "Offer submitted.", { data: { offer } });
});

// PATCH /api/offers/:id/respond
export const respondToOffer = catchAsync(async (req, res, next) => {
  const offer = await prisma.offer.findUnique({ where: { id: req.params.id }, include: { listing: true } });
  if (!offer) return next(new AppError("Offer not found.", 404));
  if (offer.sellerId !== req.user.id) return next(new AppError("Only the seller can respond to this offer.", 403));
  if (!["pending", "countered"].includes(offer.status)) return next(new AppError("This offer is no longer active.", 400));
  if (offer.expiresAt < new Date()) {
    await prisma.offer.update({ where: { id: offer.id }, data: { status: "expired" } });
    return next(new AppError("This offer has expired.", 400));
  }

  const { action, counterPrice, counterMessage } = req.body;
  if (!["accept", "decline", "counter"].includes(action)) return next(new AppError("Action must be accept, decline, or counter.", 400));

  const historyEntry = { by: req.user.id, role: "seller", action, price: action === "counter" ? counterPrice : offer.offerPrice, message: counterMessage };
  const updateData = { history: [...(offer.history || []), historyEntry] };

  if (action === "accept") {
    updateData.status = "accepted"; updateData.acceptedAt = new Date();
    await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: offer.buyerId, type: "offer_accepted", title: "Your Offer Was Accepted!", message: `Your $${offer.offerPrice} offer on "${offer.listing.title}" was accepted.`, link: `/checkout?offerId=${offer.id}` } });
  } else if (action === "decline") {
    updateData.status = "declined";
    await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: offer.buyerId, type: "offer_declined", title: "Offer Declined", message: `Your offer on "${offer.listing.title}" was declined.`, link: `/listing/${offer.listingId}` } });
  } else if (action === "counter") {
    if (!counterPrice || counterPrice <= 0) return next(new AppError("Counter price is required.", 400));
    updateData.status = "countered"; updateData.counterOfferPrice = counterPrice; updateData.counterMessage = counterMessage; updateData.counterDate = new Date(); updateData.expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: offer.buyerId, type: "offer_countered", title: "Counter Offer Received", message: `Seller countered your offer with $${counterPrice} on "${offer.listing.title}"`, link: `/offers/${offer.id}` } });
  }

  const updated = await prisma.offer.update({ where: { id: offer.id }, data: updateData });
  sendSuccess(res, 200, `Offer ${action}ed.`, { data: { offer: updated } });
});

// PATCH /api/offers/:id/accept-counter
export const acceptCounter = catchAsync(async (req, res, next) => {
  const offer = await prisma.offer.findUnique({ where: { id: req.params.id } });
  if (!offer) return next(new AppError("Offer not found.", 404));
  if (offer.buyerId !== req.user.id) return next(new AppError("Only the buyer can accept a counter offer.", 403));
  if (offer.status !== "countered") return next(new AppError("No counter offer to accept.", 400));

  const historyEntry = { by: req.user.id, role: "buyer", action: "accept", price: offer.counterOfferPrice };
  const updated = await prisma.offer.update({ where: { id: offer.id }, data: { status: "accepted", offerPrice: offer.counterOfferPrice, acceptedAt: new Date(), history: [...(offer.history || []), historyEntry] } });
  await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: offer.sellerId, type: "offer_accepted", title: "Counter Offer Accepted", message: `Buyer accepted your $${offer.counterOfferPrice} counter offer.`, link: `/seller/offers/${offer.id}` } });
  sendSuccess(res, 200, "Counter offer accepted.", { data: { offer: updated } });
});

// GET /api/offers/sent
export const getSentOffers = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = { buyerId: req.user.id };
  if (req.query.status) where.status = req.query.status;

  const [offers, total] = await Promise.all([
    prisma.offer.findMany({ where, include: { listing: { select: { title: true, images: true, price: true, status: true } }, seller: { select: { username: true, feedbackScore: true } } }, orderBy: { updatedAt: "desc" }, skip, take: limit }),
    prisma.offer.count({ where }),
  ]);
  sendSuccess(res, 200, "Sent offers fetched.", { data: { offers, total, page, pages: Math.ceil(total / limit) } });
});

// GET /api/offers/received
export const getReceivedOffers = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = { sellerId: req.user.id };
  if (req.query.status) where.status = req.query.status;

  const [offers, total] = await Promise.all([
    prisma.offer.findMany({ where, include: { listing: { select: { title: true, images: true, price: true } }, buyer: { select: { username: true, feedbackScore: true } } }, orderBy: { updatedAt: "desc" }, skip, take: limit }),
    prisma.offer.count({ where }),
  ]);
  sendSuccess(res, 200, "Received offers fetched.", { data: { offers, total, page, pages: Math.ceil(total / limit) } });
});

// PATCH /api/offers/:id/cancel
export const cancelOffer = catchAsync(async (req, res, next) => {
  const offer = await prisma.offer.findUnique({ where: { id: req.params.id } });
  if (!offer) return next(new AppError("Offer not found.", 404));
  if (offer.buyerId !== req.user.id) return next(new AppError("Only the buyer can cancel an offer.", 403));
  if (!["pending", "countered"].includes(offer.status)) return next(new AppError("Cannot cancel this offer.", 400));
  const updated = await prisma.offer.update({ where: { id: offer.id }, data: { status: "cancelled" } });
  sendSuccess(res, 200, "Offer cancelled.", { data: { offer: updated } });
});