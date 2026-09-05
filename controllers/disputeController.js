import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";
import { processRefundInternal } from "../utils/refundUtils.js";

export const openDispute = catchAsync(async (req, res, next) => {
  const { orderId, type, description, attachments } = req.body;
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return next(new AppError("Order not found.", 404));
  if (order.buyerId !== req.user.id) return next(new AppError("Only the buyer can open a dispute.", 403));
  if (!["paid", "processing", "shipped", "delivered", "partially_shipped"].includes(order.status)) return next(new AppError("Cannot open a dispute for this order status.", 400));
  if (order.hasDispute) return next(new AppError("A dispute already exists for this order.", 400));

  const sellerIds = [...new Set(order.items.map((i) => i.sellerId))];
  const sellerId = sellerIds[0];
  const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const timeline = [{ action: "Dispute opened", by: req.user.id, note: description, date: new Date() }];

  const dispute = await prisma.dispute.create({ data: { orderId, buyerId: req.user.id, sellerId, type, description, attachments: attachments || [], status: "awaiting_seller_response", dueDate, timeline } });
  await prisma.order.update({ where: { id: orderId }, data: { hasDispute: true, status: "disputed" } });
  await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: sellerId, type: "dispute_opened", title: "Dispute Opened Against You", message: `A buyer opened a "${type.replace(/_/g, " ")}" dispute for order #${order.orderNumber}`, link: `/seller/disputes/${dispute.id}` } });

  sendSuccess(res, 201, "Dispute opened.", { data: { dispute } });
});

export const getDispute = catchAsync(async (req, res, next) => {
  const dispute = await prisma.dispute.findUnique({ where: { id: req.params.id }, include: { buyer: { select: { username: true, email: true, avatar: true } }, seller: { select: { username: true, email: true, avatar: true, feedbackScore: true } }, order: { select: { orderNumber: true, total: true, status: true } } } });
  if (!dispute) return next(new AppError("Dispute not found.", 404));
  const isBuyer = dispute.buyerId === req.user.id, isSeller = dispute.sellerId === req.user.id, isAdmin = req.user.role === "admin";
  if (!isBuyer && !isSeller && !isAdmin) return next(new AppError("Not authorized.", 403));
  sendSuccess(res, 200, "Dispute fetched.", { data: { dispute } });
});

export const getMyDisputes = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = req.query.role === "seller" ? { sellerId: req.user.id } : { buyerId: req.user.id };
  if (req.query.status) where.status = req.query.status;
  const [disputes, total] = await Promise.all([
    prisma.dispute.findMany({ where, include: { order: { select: { orderNumber: true, total: true } }, buyer: { select: { username: true } }, seller: { select: { username: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.dispute.count({ where }),
  ]);
  sendSuccess(res, 200, "Disputes fetched.", { data: { disputes, total, page, pages: Math.ceil(total / limit) } });
});

export const sellerRespond = catchAsync(async (req, res, next) => {
  const d = await prisma.dispute.findUnique({ where: { id: req.params.id } });
  if (!d) return next(new AppError("Dispute not found.", 404));
  if (d.sellerId !== req.user.id) return next(new AppError("Only the seller can respond.", 403));
  if (!["awaiting_seller_response"].includes(d.status)) return next(new AppError("No seller response required at this stage.", 400));

  const { response, attachments } = req.body;
  const timeline = [...(d.timeline || []), { action: "Seller responded", by: req.user.id, note: response, date: new Date() }];
  const atts = [...(d.attachments || []), ...(attachments || [])];
  const updated = await prisma.dispute.update({ where: { id: d.id }, data: { status: "awaiting_buyer_response", dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), timeline, attachments: atts } });
  await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: d.buyerId, type: "dispute_opened", title: "Seller Responded to Dispute", message: "The seller has responded to your dispute.", link: `/disputes/${d.id}` } });
  sendSuccess(res, 200, "Response submitted.", { data: { dispute: updated } });
});

export const escalateDispute = catchAsync(async (req, res, next) => {
  const d = await prisma.dispute.findUnique({ where: { id: req.params.id } });
  if (!d) return next(new AppError("Dispute not found.", 404));
  if (d.buyerId !== req.user.id && d.sellerId !== req.user.id) return next(new AppError("Not authorized.", 403));
  if (["resolved_refund", "resolved_no_refund", "closed"].includes(d.status)) return next(new AppError("Dispute is already resolved.", 400));
  const timeline = [...(d.timeline || []), { action: "Escalated to eBay", by: req.user.id, note: req.body.reason || "User requested escalation", date: new Date() }];
  const updated = await prisma.dispute.update({ where: { id: d.id }, data: { status: "escalated_to_ebay", escalatedAt: new Date(), timeline } });
  sendSuccess(res, 200, "Dispute escalated.", { data: { dispute: updated } });
});

export const resolveDispute = catchAsync(async (req, res, next) => {
  if (req.user.role !== "admin") return next(new AppError("Only administrators can resolve disputes.", 403));

  const d = await prisma.dispute.findUnique({ where: { id: req.params.id }, include: { order: { include: { payment: true } } } });
  if (!d) return next(new AppError("Dispute not found.", 404));
  
  const { decision, amount, notes } = req.body;
  if (!["full_refund", "partial_refund", "no_refund", "replacement", "return"].includes(decision)) return next(new AppError("Invalid resolution decision.", 400));
  
  const timeline = [...(d.timeline || []), { action: `Resolved: ${decision.replace(/_/g, " ")}`, by: req.user.id, note: notes, date: new Date() }];
  
  // Real Gateway Refund if applicable
  if (["full_refund", "partial_refund"].includes(decision)) {
    const payment = d.order?.payment;
    if (payment) {
      const refundAmount = decision === "full_refund" ? d.order.total : parseFloat(amount);
      const { newStatus } = await processRefundInternal(payment, refundAmount, notes || "Dispute Resolution Refund", req.user.id, { disputeId: d.id, orderId: d.orderId });
      
      await prisma.order.update({ 
        where: { id: d.orderId }, 
        data: { 
          status: "refunded", 
          paymentStatus: newStatus === "refunded" ? "fully_refunded" : "partially_refunded" 
        } 
      });
    } else {
      // No payment record found, but we still update the order status (maybe it was cash or something else handled manually)
      await prisma.order.update({ where: { id: d.orderId }, data: { status: "refunded", paymentStatus: decision === "full_refund" ? "fully_refunded" : "partially_refunded" } });
    }
  }

  const updated = await prisma.dispute.update({ where: { id: d.id }, data: { status: decision === "no_refund" ? "resolved_no_refund" : "resolved_refund", resolution: { decision, amount: amount || 0, notes, resolvedBy: req.user.id, resolvedAt: new Date() }, timeline } });

  for (const userId of [d.buyerId, d.sellerId]) {
    await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId, type: "dispute_resolved", title: "Dispute Resolved", message: `Your dispute has been resolved: ${decision.replace(/_/g, " ")}`, link: `/disputes/${d.id}` } });
  }
  sendSuccess(res, 200, "Dispute resolved.", { data: { dispute: updated } });
});

export const closeDispute = catchAsync(async (req, res, next) => {
  const d = await prisma.dispute.findUnique({ where: { id: req.params.id } });
  if (!d) return next(new AppError("Dispute not found.", 404));
  if (d.buyerId !== req.user.id) return next(new AppError("Only the buyer can close a dispute.", 403));
  const timeline = [...(d.timeline || []), { action: "Closed by buyer", by: req.user.id, note: req.body.reason || "Issue resolved", date: new Date() }];
  const updated = await prisma.dispute.update({ where: { id: d.id }, data: { status: "closed", timeline } });
  await prisma.order.update({ where: { id: d.orderId }, data: { hasDispute: false, status: "delivered" } });
  sendSuccess(res, 200, "Dispute closed.", { data: { dispute: updated } });
});

export const getAllDisputes = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.type) where.type = req.query.type;
  const [disputes, total] = await Promise.all([
    prisma.dispute.findMany({ where, include: { buyer: { select: { username: true, email: true } }, seller: { select: { username: true, email: true } }, order: { select: { orderNumber: true, total: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.dispute.count({ where }),
  ]);
  sendSuccess(res, 200, "All disputes fetched.", { data: { disputes, total, page, pages: Math.ceil(total / limit) } });
});

export const assignDispute = catchAsync(async (req, res, next) => {
  const d = await prisma.dispute.update({ where: { id: req.params.id }, data: { adminAssignedId: req.user.id } }).catch(() => null);
  if (!d) return next(new AppError("Dispute not found.", 404));
  sendSuccess(res, 200, "Dispute assigned.", { data: { dispute: d } });
});