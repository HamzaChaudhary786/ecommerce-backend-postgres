import prisma from "../config/db.js";
import { getIo } from "../socket.js";
import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";

const autoReplyRules = [
  { keywords: ["refund", "money back", "return"], reply: "We have received your refund request. Our team will review and process it in accordance with our policy. You will receive an update shortly." },
  { keywords: ["delivery", "delivered", "shipping", "shipped", "track"], reply: "It looks like you're asking about your delivery. Please check 'Orders' for real-time tracking. Standard delivery is 3-5 business days." },
  { keywords: ["payment", "charged", "billing", "card", "pay"], reply: "Thank you for reaching out about a payment query. Our finance team will investigate and rectify immediately." },
  { keywords: ["cancel", "cancellation"], reply: "Cancellations are only possible before the order is shipped. You can initiate a return afterwards." },
];

// Helper: fetch responses and manually attach sender data (avoids Prisma include issues)
async function getResponsesWithSenders(ticketId) {
  const responses = await prisma.ticketResponse.findMany({
    where: { ticketId },
    orderBy: { createdAt: "asc" }
  });
  if (!responses.length) return [];
  const senderIds = [...new Set(responses.map((r) => r.senderId).filter(Boolean))];
  const senders = await prisma.user.findMany({
    where: { id: { in: senderIds } },
    select: { id: true, username: true, name: true, avatar: true, role: true }
  });
  const senderMap = Object.fromEntries(senders.map((s) => [s.id, s]));
  return responses.map((r) => ({ ...r, sender: senderMap[r.senderId] || null }));
}

// POST /api/support/tickets
export const createTicket = catchAsync(async (req, res, next) => {
  const { subject, message, type, priority, attachments } = req.body;
  if (!["buyer_query", "seller_query"].includes(type)) return next(new AppError("Invalid query type.", 400));

  const ticket = await prisma.supportTicket.create({ data: { userId: req.user.id, subject, message: message || null, type, priority: priority || "medium", attachments: (attachments || []).map((a) => (typeof a === "string" ? { url: a, type: "image", filename: a.split("/").pop() } : a)) } });

  const combinedText = (subject + " " + (message || "")).toLowerCase();
  let autoResponse = autoReplyRules.find((r) => r.keywords.some((k) => combinedText.includes(k)))?.reply || "Thank you for contacting our support. A representative will get back to you soon.";

  try {
    const staff = await prisma.user.findFirst({ where: { role: { in: ["subadmin", "admin"] } } });
    if (staff) {
      const ticketCount = await prisma.supportTicket.count({ where: { userId: req.user.id } });
      const responsesToCreate = [];
      if (ticketCount === 1) responsesToCreate.push({ ticketId: ticket.id, senderId: staff.id, message: "Hello! Thank you for reaching out. We are eager to support you.", isAuto: true });
      responsesToCreate.push({ ticketId: ticket.id, senderId: staff.id, message: autoResponse, isAuto: true });
      await prisma.ticketResponse.createMany({ data: responsesToCreate });
      await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: "in_progress", assignedToId: staff.id } });

      try {
        const notif = await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: req.user.id, type: "query_reply", title: `Subject: ${subject}`, message: `Reply: ${autoResponse.substring(0, 50)}...`, link: type === "buyer_query" ? `/buyer/support/history?ticketId=${ticket.id}` : `/seller/support/history?ticketId=${ticket.id}` } });
        const io = getIo();
        if (io) io.to(`user:${req.user.id}`).emit("newNotification", notif);
      } catch (notifErr) {
        console.error("User notification failed (non-critical):", notifErr.message);
      }
    }
  } catch (autoErr) {
    console.error("Auto-response failed (non-critical):", autoErr.message);
  }

  try {
    const allStaff = await prisma.user.findMany({ where: { role: { in: ["subadmin", "admin"] } } });
    const io = getIo();
    for (const admin of allStaff) {
      try {
        const adminNotif = await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: admin.id, type: "new_query", title: "New Support Query", message: `From ${req.user.username || req.user.name || "Customer"}: "${subject.substring(0, 50)}"`, link: `/subadmin/queries?ticketId=${ticket.id}` } });
        if (io) io.to(`user:${admin.id}`).emit("newNotification", adminNotif);
      } catch (e) {
        console.error("Admin notification failed:", e.message);
      }
    }
  } catch (staffErr) {
    console.error("Staff notification failed (non-critical):", staffErr.message);
  }

  const full = await prisma.supportTicket.findUnique({ 
    where: { id: ticket.id }, 
    include: { 
      user: { select: { id: true, username: true, email: true, avatar: true } } 
    } 
  });
  const responses = await getResponsesWithSenders(ticket.id);
  sendSuccess(res, 201, "Support ticket created.", { data: { ticket: { ...full, responses } } });
});

// GET /api/support/tickets
export const getAllTickets = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.priority) where.priority = req.query.priority;

  if (!["admin", "subadmin"].includes(req.user.role)) {
    where.userId = req.user.id;
    if (req.query.type) where.type = req.query.type;
  } else {
    where.type = req.query.type ? req.query.type : { in: ["buyer_query", "seller_query"] };
  }

  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({ 
      where, 
      include: { 
        user: { select: { username: true, email: true, avatar: true } }, 
        assignedTo: { select: { username: true } },
        responses: { select: { id: true } }
      }, 
      orderBy: { createdAt: "desc" }, 
      skip, 
      take: limit 
    }),
    prisma.supportTicket.count({ where }),
  ]);
  sendSuccess(res, 200, "Support tickets fetched.", { data: { tickets, total, page, pages: Math.ceil(total / limit) } });
});

// GET /api/support/tickets/:id
export const getTicket = catchAsync(async (req, res, next) => {
  const ticket = await prisma.supportTicket.findUnique({ 
    where: { id: req.params.id }, 
    include: { 
      user: { select: { id: true, username: true, email: true, avatar: true, phone: true } }, 
      assignedTo: { select: { id: true, username: true, avatar: true } } 
    } 
  });
  if (!ticket) return next(new AppError("Support ticket not found.", 404));
  if (ticket.userId !== req.user.id && !["admin", "subadmin"].includes(req.user.role)) return next(new AppError("Not authorized.", 403));

  const responses = await getResponsesWithSenders(ticket.id);
  sendSuccess(res, 200, "Support ticket fetched.", { data: { ticket: { ...ticket, responses } } });
});

// PATCH /api/support/tickets/:id/respond
export const respondToTicket = catchAsync(async (req, res, next) => {
  const { message, status, attachments, replyTo } = req.body;
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return next(new AppError("Support ticket not found.", 404));
  const isStaff = ["admin", "subadmin"].includes(req.user.role);
  if (!isStaff && ticket.userId !== req.user.id) return next(new AppError("Not authorized.", 403));

  await prisma.ticketResponse.create({ data: { ticketId: ticket.id, senderId: req.user.id, message, attachments: (attachments || []).map((a) => (typeof a === "string" ? { url: a, type: "image", filename: a.split("/").pop() } : a)), replyTo: replyTo || null } });
  const updateData = { status: status || (ticket.status === "open" ? "in_progress" : ticket.status) };
  if (isStaff) updateData.assignedToId = req.user.id;
  if (status === "resolved") updateData.resolvedAt = new Date();
  await prisma.supportTicket.update({ where: { id: ticket.id }, data: updateData });

  const io = getIo();
  const replyPreview = message.substring(0, 50) + "...";
  if (isStaff) {
    const notif = await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: ticket.userId, type: "query_reply", title: `Subject: ${ticket.subject}`, message: `Reply: ${replyPreview}`, link: ticket.type === "buyer_query" ? `/buyer/support/history?ticketId=${ticket.id}` : `/seller/support/history?ticketId=${ticket.id}` } });
    if (io) io.to(`user:${ticket.userId}`).emit("newNotification", notif);
  } else {
    const allStaff = await prisma.user.findMany({ where: { role: { in: ["admin", "subadmin"] } } });
    for (const admin of allStaff) {
      const notif = await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: admin.id, type: "query_reply", title: `Subject: ${ticket.subject}`, message: `Reply: ${replyPreview}`, link: `/subadmin/queries?ticketId=${ticket.id}` } });
      if (io) io.to(`user:${admin.id}`).emit("newNotification", notif);
    }
  }

  const full = await prisma.supportTicket.findUnique({ 
    where: { id: ticket.id }, 
    include: { 
      user: { select: { id: true, username: true, email: true, avatar: true } } 
    } 
  });
  const responses = await getResponsesWithSenders(ticket.id);
  sendSuccess(res, 200, "Response added to ticket.", { data: { ticket: { ...full, responses } } });
});

// PATCH /api/support/tickets/:id/status
export const updateStatus = catchAsync(async (req, res, next) => {
  const { status } = req.body;
  if (!["open", "in_progress", "resolved"].includes(status)) return next(new AppError("Invalid status.", 400));
  const ticket = await prisma.supportTicket.update({ where: { id: req.params.id }, data: { status, assignedToId: req.user.id, resolvedAt: status === "resolved" ? new Date() : null } }).catch(() => null);
  if (!ticket) return next(new AppError("Support ticket not found.", 404));
  sendSuccess(res, 200, "Ticket status updated.", { data: { ticket } });
});

// PATCH /api/support/tickets/:id
export const updateTicket = catchAsync(async (req, res, next) => {
  const { subject, message, priority, type } = req.body;
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return next(new AppError("Support ticket not found.", 404));
  const isStaff = ["admin", "subadmin"].includes(req.user.role);
  if (!isStaff && ticket.userId !== req.user.id) return next(new AppError("Not authorized.", 403));
  if (!isStaff && ticket.status !== "open") return next(new AppError("Cannot edit a ticket after it has been addressed.", 400));

  const data = {};
  if (subject) data.subject = subject;
  if (message) data.message = message;
  if (isStaff && priority) data.priority = priority;
  if (isStaff && type) data.type = type;

  const updated = await prisma.supportTicket.update({ where: { id: ticket.id }, data });
  sendSuccess(res, 200, "Ticket updated.", { data: { ticket: updated } });
});

// DELETE /api/support/tickets/:id
export const deleteTicket = catchAsync(async (req, res, next) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return next(new AppError("Support ticket not found.", 404));

  const isStaff = ["admin", "subadmin"].includes(req.user.role);

  // Authorization: Only owner or staff can delete
  if (!isStaff && ticket.userId !== req.user.id) {
    return next(new AppError("You are not authorized to delete this ticket.", 403));
  }

  // Business Logic: Staff can delete anything. Owners can delete their own tickets.
  // (Additional restrictions could be added here if needed, but for now we allow full owner deletion)

  // Use a transaction or ensure responses are deleted (cascade handles it)
  await prisma.supportTicket.delete({ where: { id: ticket.id } });
  
  sendSuccess(res, 200, "Ticket deleted successfully.");
});

// PATCH /api/support/tickets/:id/responses/:responseId
export const editResponse = catchAsync(async (req, res, next) => {
  const resp = await prisma.ticketResponse.findUnique({ where: { id: req.params.responseId } });
  if (!resp) return next(new AppError("Response not found.", 404));
  if (resp.senderId !== req.user.id) return next(new AppError("Not authorized.", 403));
  await prisma.ticketResponse.update({ where: { id: resp.id }, data: { message: req.body.message, isEdited: true } });
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, include: { responses: true } });
  sendSuccess(res, 200, "Response updated.", { data: { ticket } });
});

// DELETE /api/support/tickets/:id/responses/:responseId
export const deleteResponse = catchAsync(async (req, res, next) => {
  const resp = await prisma.ticketResponse.findUnique({ where: { id: req.params.responseId } });
  if (!resp) return next(new AppError("Response not found.", 404));
  const isStaff = ["admin", "subadmin"].includes(req.user.role);
  if (resp.senderId !== req.user.id && !isStaff) return next(new AppError("Not authorized.", 403));
  await prisma.ticketResponse.update({ where: { id: resp.id }, data: { isDeleted: true, message: "This message was deleted" } });
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, include: { responses: true } });
  sendSuccess(res, 200, "Response deleted.", { data: { ticket } });
});

// GET /api/support/tickets/stats
export const getTicketStats = catchAsync(async (req, res) => {
  const [total, byType, byStatus] = await Promise.all([
    prisma.supportTicket.count(),
    prisma.supportTicket.groupBy({ by: ["type"], _count: true }),
    prisma.supportTicket.groupBy({ by: ["status"], _count: true }),
  ]);
  const result = {
    total,
    buyer_queries: byType.find((t) => t.type === "buyer_query")?._count || 0,
    seller_queries: byType.find((t) => t.type === "seller_query")?._count || 0,
    open: byStatus.find((s) => s.status === "open")?._count || 0,
    inProgress: byStatus.find((s) => s.status === "in_progress")?._count || 0,
    resolved: byStatus.find((s) => s.status === "resolved")?._count || 0,
  };
  sendSuccess(res, 200, "Support statistics fetched.", { data: result });
});

