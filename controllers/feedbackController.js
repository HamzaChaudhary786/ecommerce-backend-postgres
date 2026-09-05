import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";

// POST /api/feedback
export const leaveFeedback = catchAsync(async (req, res, next) => {
  const { orderId, rating, comment, detailedRatings } = req.body;

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: { include: { seller: true } } } });
  if (!order) return next(new AppError("Order not found.", 404));
  if (!["delivered", "refunded"].includes(order.status)) return next(new AppError("Can only leave feedback for completed orders.", 400));

  const isBuyer = order.buyerId === req.user.id;
  const isSeller = order.items.some((i) => i.sellerId === req.user.id);
  if (!isBuyer && !isSeller) return next(new AppError("You are not part of this order.", 403));

  const existing = await prisma.feedback.findFirst({ where: { reviewerId: req.user.id, orderId } });
  if (existing) return next(new AppError("You have already left feedback for this order.", 400));

  let revieweeId, feedbackRole;
  if (isBuyer) {
    const sellerIds = [...new Set(order.items.map((i) => i.sellerId))];
    revieweeId = req.body.sellerId || sellerIds[0];
    feedbackRole = "buyer_to_seller";
  } else {
    revieweeId = order.buyerId;
    feedbackRole = "seller_to_buyer";
  }

  const scoreMap = { positive: 1, neutral: 0, negative: -1 };
  const feedback = await prisma.feedback.create({
    data: {
      reviewerId: req.user.id, revieweeId, orderId, listingId: order.items[0]?.listingId || null,
      role: feedbackRole, rating, score: scoreMap[rating] || 0, comment,
      itemDescription: detailedRatings?.itemDescription, communication: detailedRatings?.communication,
      shippingTime: detailedRatings?.shippingTime, shippingCost: detailedRatings?.shippingCost,
    },
  });

  // Recalculate reviewee's score
  const allFeedback = await prisma.feedback.findMany({ where: { revieweeId } });
  const totalScore = allFeedback.reduce((sum, f) => sum + f.score, 0);
  const positiveCount = allFeedback.filter((f) => f.score === 1).length;
  const positivePercent = allFeedback.length > 0 ? Math.round((positiveCount / allFeedback.length) * 100) : 100;

  await prisma.user.update({ where: { id: revieweeId }, data: { feedbackScore: totalScore, positiveFeedbackPercent: positivePercent } });
  sendSuccess(res, 201, "Feedback submitted.", { data: { feedback } });
});

// GET /api/feedback/user/:userId
export const getUserFeedback = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = { revieweeId: req.params.userId, isRemoved: false };
  if (req.query.rating) where.rating = req.query.rating;
  if (req.query.role) where.role = req.query.role;

  const [feedbacks, total] = await Promise.all([
    prisma.feedback.findMany({ where, include: { reviewer: { select: { username: true, avatar: true, feedbackScore: true } }, listing: { select: { title: true, images: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.feedback.count({ where }),
  ]);

  // Summary stats
  const allFb = await prisma.feedback.findMany({ where: { revieweeId: req.params.userId, isRemoved: false }, select: { rating: true, itemDescription: true, communication: true, shippingTime: true, shippingCost: true } });
  const summary = { positive: 0, neutral: 0, negative: 0, avgItemDescription: 0, avgCommunication: 0, avgShippingTime: 0, avgShippingCost: 0 };
  allFb.forEach((f) => { summary[f.rating] = (summary[f.rating] || 0) + 1; });
  const avg = (field) => allFb.length ? allFb.reduce((s, f) => s + (f[field] || 0), 0) / allFb.length : 0;
  summary.avgItemDescription = avg("itemDescription"); summary.avgCommunication = avg("communication"); summary.avgShippingTime = avg("shippingTime"); summary.avgShippingCost = avg("shippingCost");

  sendSuccess(res, 200, "Feedback fetched.", { data: { feedbacks, total, summary, page, pages: Math.ceil(total / limit) } });
});

// PATCH /api/feedback/:id/reply
export const replyToFeedback = catchAsync(async (req, res, next) => {
  const fb = await prisma.feedback.findUnique({ where: { id: req.params.id } });
  if (!fb) return next(new AppError("Feedback not found.", 404));
  if (fb.revieweeId !== req.user.id) return next(new AppError("Only the feedback recipient can reply.", 403));
  if (fb.reply) return next(new AppError("You have already replied to this feedback.", 400));
  const updated = await prisma.feedback.update({ where: { id: fb.id }, data: { reply: req.body.reply, replyDate: new Date() } });
  sendSuccess(res, 200, "Reply added.", { data: { feedback: updated } });
});

// PATCH /api/feedback/:id/report
export const reportFeedback = catchAsync(async (req, res, next) => {
  const fb = await prisma.feedback.findUnique({ where: { id: req.params.id } });
  if (!fb) return next(new AppError("Feedback not found.", 404));
  if (fb.revieweeId !== req.user.id) return next(new AppError("Only the feedback recipient can report it.", 403));
  const updated = await prisma.feedback.update({ where: { id: fb.id }, data: { isReported: true, reportReason: req.body.reason } });
  sendSuccess(res, 200, "Feedback reported.", { data: { feedback: updated } });
});

// PATCH /api/feedback/:id/remove
export const removeFeedback = catchAsync(async (req, res, next) => {
  const fb = await prisma.feedback.update({ where: { id: req.params.id }, data: { isRemoved: true, removedById: req.user.id } }).catch(() => null);
  if (!fb) return next(new AppError("Feedback not found.", 404));
  sendSuccess(res, 200, "Feedback removed.", { data: { feedback: fb } });
});