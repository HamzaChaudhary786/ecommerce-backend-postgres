import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";

// POST /api/questions
export const askQuestion = catchAsync(async (req, res, next) => {
  const { listingId, question } = req.body;
  if (!listingId || !question) return next(new AppError("Listing ID and question are required.", 400));

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) return next(new AppError("Listing not found.", 404));
  if (listing.sellerId === req.user.id) return next(new AppError("You cannot ask questions about your own product.", 400));

  const newQ = await prisma.question.create({ data: { listingId, buyerId: req.user.id, sellerId: listing.sellerId, question } });

  await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: listing.sellerId, type: "new_question", targetRole: "seller", title: "New Question on Your Product", message: `A buyer asked: "${question.slice(0, 80)}${question.length > 80 ? "…" : ""}" about "${listing.title}"`, link: `/seller/questions` } });

  sendSuccess(res, 201, "Question posted successfully.", { data: { question: newQ } });
});

// PATCH /api/questions/:id/answer
export const answerQuestion = catchAsync(async (req, res, next) => {
  const { answer } = req.body;
  if (!answer) return next(new AppError("Answer is required.", 400));

  const q = await prisma.question.findUnique({ where: { id: req.params.id }, include: { listing: { select: { title: true } } } });
  if (!q) return next(new AppError("Question not found.", 404));
  if (q.sellerId !== req.user.id) return next(new AppError("Not authorized.", 403));

  const updated = await prisma.question.update({ where: { id: q.id }, data: { answer, status: "answered", answeredAt: new Date() } });
  await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: q.buyerId, type: "question_answered", title: "Question Answered", message: `The seller answered your question about ${q.listing.title}` } });

  sendSuccess(res, 200, "Question answered successfully.", { data: { question: updated } });
});

// GET /api/questions/listing/:listingId
export const getListingQuestions = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const [questions, total] = await Promise.all([
    prisma.question.findMany({ where: { listingId: req.params.listingId }, include: { buyer: { select: { name: true, avatar: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.question.count({ where: { listingId: req.params.listingId } }),
  ]);
  sendSuccess(res, 200, "Questions fetched.", { data: { questions, total, page, pages: Math.ceil(total / limit) } });
});

// GET /api/questions/seller
export const getSellerQuestions = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = { sellerId: req.user.id };
  if (req.query.status) where.status = req.query.status;
  const [questions, total] = await Promise.all([
    prisma.question.findMany({ where, include: { buyer: { select: { name: true, avatar: true } }, listing: { select: { title: true, images: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.question.count({ where }),
  ]);
  sendSuccess(res, 200, "Seller questions fetched.", { data: { questions, total, page, pages: Math.ceil(total / limit) } });
});

// DELETE /api/questions/:id
export const deleteQuestion = catchAsync(async (req, res, next) => {
  const q = await prisma.question.findUnique({ where: { id: req.params.id } });
  if (!q) return next(new AppError("Question not found.", 404));
  if (q.buyerId !== req.user.id && q.sellerId !== req.user.id && req.user.role !== "admin") return next(new AppError("Not authorized.", 403));
  await prisma.question.delete({ where: { id: q.id } });
  sendSuccess(res, 200, "Question deleted successfully.");
});
