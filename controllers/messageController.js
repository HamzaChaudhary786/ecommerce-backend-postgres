import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess } from "../utils/helpers.js";

export const getConversations = catchAsync(async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    where: { isArchived: false, participants: { some: { userId: req.user.id } } },
    include: {
      participants: { include: { user: { select: { id: true, name: true, firstName: true, lastName: true, avatar: true, email: true, role: true, username: true } } } },
      listing: { select: { title: true, images: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: { select: { id: true, name: true, firstName: true, lastName: true } } } },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  const enriched = conversations.map(c => ({
    ...c,
    lastMessage: c.messages?.[0] || null
  }));

  sendSuccess(res, 200, "Conversations fetched", { conversations: enriched });
});

export const getMessages = catchAsync(async (req, res, next) => {
  const conv = await prisma.conversation.findUnique({ where: { id: req.params.id }, include: { participants: true } });
  if (!conv) return next(new AppError("Conversation not found", 404));
  const isParticipant = conv.participants.some((p) => p.userId === req.user.id);
  if (!isParticipant && req.user.role !== "admin") return next(new AppError("Not authorized", 403));

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const messages = await prisma.message.findMany({
    where: { conversationId: req.params.id, isDeleted: false, NOT: { deletedBy: { has: req.user.id } } },
    include: { sender: { select: { id: true, name: true, firstName: true, lastName: true, avatar: true, role: true } } },
    orderBy: { createdAt: "asc" }, skip: (page - 1) * limit, take: limit,
  });
  sendSuccess(res, 200, "Messages fetched", { messages });
});

export const sendMessage = catchAsync(async (req, res, next) => {
  const { recipientId, content, conversationId, listingId, subject, type, replyTo } = req.body;
  if (!content?.trim()) return next(new AppError("Message content is required", 400));

  let conv;
  if (conversationId) {
    conv = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { participants: true } });
    if (!conv) return next(new AppError("Conversation not found", 404));
    const isP = conv.participants.some((p) => p.userId === req.user.id);
    if (!isP && req.user.role !== "admin") return next(new AppError("Not authorized", 403));
  } else {
    if (!recipientId) return next(new AppError("Recipient ID is required", 400));
    const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient) return next(new AppError("Recipient not found", 404));

    // Find existing conversation between these two
    const existing = await prisma.conversation.findFirst({
      where: { listingId: listingId || undefined, participants: { every: { userId: { in: [req.user.id, recipientId] } } } },
      include: { participants: true },
    });

    if (existing && existing.participants.length === 2) {
      conv = existing;
    } else {
      conv = await prisma.conversation.create({
        data: {
          listingId: listingId || null, subject: subject || "", type: type || "general",
          participants: { create: [{ userId: req.user.id }, { userId: recipientId }] },
        },
        include: { participants: true },
      });
    }
  }

  const message = await prisma.message.create({
    data: { conversationId: conv.id, senderId: req.user.id, content: content.trim(), replyToId: replyTo || null },
    include: { sender: { select: { id: true, name: true, firstName: true, lastName: true, avatar: true, role: true } } },
  });

  await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
  await prisma.conversationParticipant.updateMany({ where: { conversationId: conv.id, userId: { not: req.user.id } }, data: { unreadCount: { increment: 1 } } });

  sendSuccess(res, 201, "Message sent", { message, conversationId: conv.id, conversation: conv });
});

export const markMessagesAsRead = catchAsync(async (req, res, next) => {
  const conv = await prisma.conversation.findUnique({ where: { id: req.params.conversationId } });
  if (!conv) return next(new AppError("Conversation not found", 404));
  await prisma.message.updateMany({ where: { conversationId: req.params.conversationId, senderId: { not: req.user.id }, isRead: false }, data: { isRead: true, readAt: new Date() } });
  await prisma.conversationParticipant.updateMany({ where: { conversationId: req.params.conversationId, userId: req.user.id }, data: { unreadCount: 0 } });
  sendSuccess(res, 200, "Messages marked as read");
});

export const adminGetAllConversations = catchAsync(async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    include: { participants: { include: { user: { select: { id: true, name: true, firstName: true, lastName: true, avatar: true, email: true, role: true } } } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { lastMessageAt: "desc" }, take: 100,
  });

  const enriched = conversations.map(c => ({
    ...c,
    lastMessage: c.messages?.[0] || null
  }));

  sendSuccess(res, 200, "All conversations fetched", { conversations: enriched });
});

export const editMessage = catchAsync(async (req, res, next) => {
  const { content } = req.body;
  const message = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!message) return next(new AppError("Message not found", 404));
  if (message.senderId !== req.user.id) return next(new AppError("Not authorized", 403));
  const updated = await prisma.message.update({ where: { id: message.id }, data: { content, isEdited: true }, include: { sender: { select: { id: true, name: true, firstName: true, lastName: true, avatar: true, role: true } } } });
  sendSuccess(res, 200, "Message edited", { message: updated });
});

export const deleteMessage = catchAsync(async (req, res, next) => {
  const message = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!message) return next(new AppError("Message not found", 404));
  if (message.senderId !== req.user.id && req.user.role !== "admin") return next(new AppError("Not authorized", 403));
  await prisma.message.update({ where: { id: message.id }, data: { isDeleted: true, content: "This message was deleted" } });
  sendSuccess(res, 200, "Message deleted", { messageId: message.id });
});
