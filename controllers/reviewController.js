import { Readable } from "stream";
import { cloudinary } from "../config/cloudinary.js";
import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";

function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(stream);
  });
}

// POST /api/reviews/upload-image
export const uploadReviewImage = catchAsync(async (req, res, next) => {
  if (!req.file) return next(new AppError("No image file provided.", 400));
  const result = await uploadBufferToCloudinary(req.file.buffer, { folder: "ecommerce/reviews", resource_type: "image" });
  sendSuccess(res, 200, "Image uploaded.", { url: result.secure_url, public_id: result.public_id });
});

// POST /api/reviews/listing/:listingId
export const createReview = catchAsync(async (req, res, next) => {
  const { listingId } = req.params;
  const userId = req.user.id;
  const { rating, comment, images, orderId } = req.body;

  if (!rating || !comment) return next(new AppError("Rating and comment are required.", 400));

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) return next(new AppError("Listing not found.", 404));

  // Verify purchase
  const orderWhere = { buyerId: userId, status: { not: "cancelled" }, items: { some: { listingId } } };
  if (orderId) orderWhere.id = orderId;
  const orders = await prisma.order.findMany({ where: orderWhere, include: { items: { where: { listingId } } } });

  let verifiedOrderId = null;
  for (const order of orders) {
    const delivered = order.items.some((i) => i.itemStatus === "delivered");
    if (delivered) {
      const already = await prisma.review.findUnique({ where: { listingId_userId_orderId: { listingId, userId, orderId: order.id } } });
      if (!already) { verifiedOrderId = order.id; break; }
    }
  }
  if (!verifiedOrderId) return next(new AppError("You can only review products that have been delivered.", 403));

  const existing = await prisma.review.findUnique({ where: { listingId_userId_orderId: { listingId, userId, orderId: verifiedOrderId } } });
  if (existing) return next(new AppError("You have already reviewed this purchase.", 400));

  const review = await prisma.review.create({
    data: { listingId, userId, orderId: verifiedOrderId, rating: Number(rating), comment: comment.trim(), images: images || [], isVerifiedPurchase: true },
    include: { user: { select: { username: true, firstName: true, lastName: true, avatar: true } } },
  });

  // Recalculate listing avg rating
  const agg = await prisma.review.aggregate({ where: { listingId, status: "approved" }, _avg: { rating: true }, _count: true });
  await prisma.listing.update({ where: { id: listingId }, data: { averageRating: agg._avg.rating || 0, reviewCount: agg._count } });

  await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: listing.sellerId, type: "new_review", title: "New Review on Your Product", message: `A buyer left a ${rating}-star review on "${listing.title}".` } });
  sendSuccess(res, 201, "Your review has been submitted and is under approval.", { review });
});

// GET /api/reviews/listing/:listingId
export const getListingReviews = catchAsync(async (req, res, next) => {
  const { listingId } = req.params;
  const { sort = "latest", rating: filterRating } = req.query;
  const { page, limit, skip } = paginate(req.query);

  const sortMap = { latest: { createdAt: "desc" }, oldest: { createdAt: "asc" }, highest: { rating: "desc" }, lowest: { rating: "asc" }, helpful: { helpfulVotes: "desc" } };
  const where = { listingId, status: "approved" };
  if (filterRating) where.rating = Number(filterRating);

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({ where, include: { user: { select: { username: true, firstName: true, lastName: true, avatar: true } } }, orderBy: sortMap[sort] || { createdAt: "desc" }, skip, take: limit }),
    prisma.review.count({ where }),
  ]);

  const distribution = await prisma.review.groupBy({ by: ["rating"], where: { listingId, status: "approved" }, _count: true });
  const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let totalRatingSum = 0, totalCount = 0;
  distribution.forEach((d) => { breakdown[d.rating] = d._count; totalRatingSum += d.rating * d._count; totalCount += d._count; });
  const averageRating = totalCount > 0 ? Math.round((totalRatingSum / totalCount) * 10) / 10 : 0;

  sendSuccess(res, 200, "Reviews fetched.", { reviews, breakdown, averageRating, totalReviews: totalCount, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
});

// GET /api/reviews/listing/:listingId/my-review
export const getMyReview = catchAsync(async (req, res, next) => {
  const { orderId } = req.query;
  const { listingId } = req.params;
  const userId = req.user.id;

  const where = { listingId, userId };
  if (orderId) where.orderId = orderId;
  const review = await prisma.review.findFirst({ where });

  const orders = await prisma.order.findMany({ where: { buyerId: userId, status: { not: "cancelled" }, items: { some: { listingId, itemStatus: "delivered" } } } });
  let pendingOrderId = null;
  for (const order of orders) {
    const already = await prisma.review.findUnique({ where: { listingId_userId_orderId: { listingId, userId, orderId: order.id } } });
    if (!already) { pendingOrderId = order.id; break; }
  }
  sendSuccess(res, 200, "Fetched.", { review: review || null, pendingOrderId });
});

// PATCH /api/reviews/:reviewId
export const updateReview = catchAsync(async (req, res, next) => {
  const review = await prisma.review.findUnique({ where: { id: req.params.reviewId } });
  if (!review) return next(new AppError("Review not found.", 404));
  if (review.userId !== req.user.id && req.user.role !== "admin") return next(new AppError("Not authorized.", 403));

  const { rating, comment, images } = req.body;
  const updated = await prisma.review.update({
    where: { id: req.params.reviewId },
    data: { ...(rating && { rating: Number(rating) }), ...(comment && { comment: comment.trim() }), ...(images !== undefined && { images }) },
    include: { user: { select: { username: true, firstName: true, lastName: true, avatar: true } } },
  });
  sendSuccess(res, 200, "Review updated.", { review: updated });
});

// DELETE /api/reviews/:reviewId
export const deleteReview = catchAsync(async (req, res, next) => {
  const review = await prisma.review.findUnique({ where: { id: req.params.reviewId } });
  if (!review) return next(new AppError("Review not found.", 404));
  if (review.userId !== req.user.id && req.user.role !== "admin") return next(new AppError("Not authorized.", 403));

  if (review.images?.length > 0) {
    await Promise.all(review.images.filter((img) => img.public_id).map((img) => cloudinary.uploader.destroy(img.public_id).catch(() => { })));
  }
  await prisma.review.delete({ where: { id: req.params.reviewId } });
  sendSuccess(res, 200, "Review deleted.");
});

// POST /api/reviews/:reviewId/helpful
export const voteHelpful = catchAsync(async (req, res, next) => {
  const review = await prisma.review.findUnique({ where: { id: req.params.reviewId } });
  if (!review) return next(new AppError("Review not found.", 404));

  const userId = req.user.id;
  const alreadyVoted = review.helpfulVoters.includes(userId);
  const updatedVoters = alreadyVoted ? review.helpfulVoters.filter((v) => v !== userId) : [...review.helpfulVoters, userId];

  const updated = await prisma.review.update({ where: { id: review.id }, data: { helpfulVoters: updatedVoters, helpfulVotes: updatedVoters.length } });
  sendSuccess(res, 200, alreadyVoted ? "Vote removed." : "Marked as helpful.", { helpfulVotes: updated.helpfulVotes, voted: !alreadyVoted });
});

// GET /api/reviews/admin
export const adminGetAllReviews = catchAsync(async (req, res, next) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({ where, include: { user: { select: { username: true, firstName: true, lastName: true, avatar: true } }, listing: { select: { title: true, images: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.review.count({ where }),
  ]);
  sendSuccess(res, 200, "Fetched all reviews.", { reviews, total, page, pages: Math.ceil(total / limit) });
});

// PATCH /api/reviews/admin/:reviewId
export const adminUpdateReviewStatus = catchAsync(async (req, res, next) => {
  const { status, adminNote, isVisible } = req.body;
  if (!["pending", "approved", "rejected"].includes(status)) return next(new AppError("Invalid status.", 400));

  const review = await prisma.review.update({
    where: { id: req.params.reviewId },
    data: { status, adminNote, isVisible: isVisible !== undefined ? isVisible : status === "approved" },
    include: { listing: { select: { title: true } } },
  }).catch(() => null);
  if (!review) return next(new AppError("Review not found.", 404));

  await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: review.userId, type: status === "approved" ? "review_approved" : "review_rejected", title: status === "approved" ? "Review Approved!" : "Review Not Approved", message: `Your review for "${review.listing?.title}" has been ${status}.` } });

  // Recalculate listing avg
  const agg = await prisma.review.aggregate({ where: { listingId: review.listingId, status: "approved" }, _avg: { rating: true }, _count: true });
  await prisma.listing.update({ where: { id: review.listingId }, data: { averageRating: agg._avg.rating || 0, reviewCount: agg._count } });

  sendSuccess(res, 200, `Review ${status}.`, { review });
});
