import prisma from "./config/db.js";

// Track online users: userId -> Set of socketIds
const onlineUsers = new Map();
let io;

// Parse cookie string into object
const parseCookies = (cookieStr = "") => {
  const cookies = {};
  cookieStr.split(";").forEach((part) => {
    const [k, ...v] = part.trim().split("=");
    if (k) cookies[k.trim()] = decodeURIComponent(v.join("="));
  });
  return cookies;
};

// Authenticate via session cookie (Passport session)
const authenticateSocket = async (socket, next) => {
  try {
    // 1. Try Passport session (the primary auth method)
    if (socket.request?.user?.id) {
      socket.user = socket.request.user;
      return next();
    }

    // 2. Try session manually from connect.sid cookie
    // const cookies = parseCookies(socket.handshake.headers.cookie);
    
    // 3. Fallback: check if userId was passed in handshake query (for non-session clients)
    const userId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, firstName: true, lastName: true, avatar: true, role: true, email: true, isSuspended: true }
      });
      if (user && !user.isSuspended) {
        socket.user = user;
        return next();
      }
    }

    // Auth failed — disconnect gracefully
    return next(new Error("Authentication required"));
  } catch (err) {
    console.error("Socket auth error:", err.message);
    next(new Error("Authentication error"));
  }
};

export const initSocket = (socketIo) => {
  io = socketIo;
  // Apply auth middleware
  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const userId = socket.user.id;
    console.log(`🔌 Socket connected: ${socket.user.name || socket.user.email} (${userId})`);

    // Add to online users
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    // Join personal room
    socket.join(`user:${userId}`);

    // Broadcast online status
    broadcastOnlineStatus(io, socket.user, true);

    // ─── JOIN CONVERSATION ROOM ──────────────────────────────────
    socket.on("joinConversation", async ({ conversationId }) => {
      try {
        const conversation = await prisma.conversation.findUnique({
          where: { id: conversationId },
          include: { participants: { select: { userId: true } } }
        });
        if (!conversation) return;
        const isParticipant = conversation.participants.some((p) => p.userId === userId);
        if (isParticipant || socket.user.role === "admin") {
          socket.join(`conversation:${conversationId}`);
        }
      } catch (err) {
        console.error("joinConversation error:", err);
      }
    });

    // ─── SEND MESSAGE ────────────────────────────────────────────
    socket.on("sendMessage", async ({ conversationId, recipientId, content, listingId, subject, type, replyTo }) => {
      try {
        if (!content?.trim()) return;

        let conversation;

        if (conversationId) {
          conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { participants: { select: { userId: true } } }
          });
        } else if (recipientId) {
          // Find conversation with exactly these two participants and optional listing
          conversation = await prisma.conversation.findFirst({
            where: {
              AND: [
                { participants: { some: { userId: userId } } },
                { participants: { some: { userId: recipientId } } },
                { participants: { size: 2 } }, // Note: Prisma doesn't support 'size' on many-to-many easily
                listingId ? { listingId: listingId } : { listingId: null }
              ]
            },
            include: { participants: { select: { userId: true } } }
          });

          if (!conversation) {
            conversation = await prisma.conversation.create({
              data: {
                participants: { create: [{ userId: userId }, { userId: recipientId }] },
                listingId: listingId || null,
                subject: subject || "",
                type: type || "general",
              },
              include: { participants: { select: { userId: true } } }
            });
          }
        }

        if (!conversation) return;

        const message = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderId: userId,
            content: content.trim(),
            replyToId: replyTo || undefined 
          },
          include: {
            sender: { select: { id: true, name: true, firstName: true, lastName: true, avatar: true, role: true } }
          }
        });

        // Update conversation metadata
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageId: message.id,
            lastMessageAt: new Date(),
            unreadCount: {
              updateMany: {
                where: { userId: { not: userId } },
                data: { count: { increment: 1 } }
              }
            }
          }
        });

        const populatedConversation = await prisma.conversation.findUnique({
          where: { id: conversation.id },
          include: {
            participants: { include: { user: { select: { id: true, name: true, firstName: true, lastName: true, avatar: true, email: true, role: true } } } },
            messages: { orderBy: { createdAt: "desc" }, take: 1 }
          }
        });

        // Emit to conversation room
        io.to(`conversation:${conversation.id}`).emit("newMessage", message);

        // Emit directly to all participants' personal rooms
        populatedConversation.participants.forEach((p) => {
          const pid = p.userId;
          io.to(`user:${pid}`).emit("newMessage", message);
          if (pid !== userId) {
            io.to(`user:${pid}`).emit("conversationUpdated", populatedConversation);
          }
        });

        // Confirm to sender
        socket.emit("messageSent", {
          message: message,
          conversation: populatedConversation,
        });

      } catch (err) {
        console.error("sendMessage socket error:", err);
        socket.emit("messageError", { error: err.message });
      }
    });

    // ─── EDIT MESSAGE (SOCKET) ───────────────────────────────────
    socket.on("editMessage", async ({ messageId, content }) => {
      try {
        const message = await prisma.message.findUnique({ where: { id: messageId } });
        if (!message || message.senderId !== userId) return;

        const updatedMessage = await prisma.message.update({
          where: { id: messageId },
          data: { content: content, isEdited: true },
          include: {
            sender: { select: { id: true, name: true, firstName: true, lastName: true, avatar: true, role: true } },
            replyTo: true
          }
        });

        io.to(`conversation:${message.conversationId}`).emit("messageEdited", updatedMessage);
      } catch (err) {
        console.error("editMessage socket error:", err);
      }
    });

    // ─── DELETE MESSAGE (SOCKET) ─────────────────────────────────
    socket.on("deleteMessage", async ({ messageId }) => {
      try {
        const message = await prisma.message.findUnique({ where: { id: messageId } });
        if (!message) return;
        
        const isOwner = message.senderId === userId;
        const isAdmin = socket.user.role === "admin";
        if (!isOwner && !isAdmin) return;

        const updatedMessage = await prisma.message.update({
          where: { id: messageId },
          data: { isDeleted: true, content: "This message was deleted" }
        });

        io.to(`conversation:${message.conversationId}`).emit("messageDeleted", { 
          messageId: updatedMessage.id,
          content: updatedMessage.content,
          isDeleted: true
        });
      } catch (err) {
        console.error("deleteMessage socket error:", err);
      }
    });

    // ─── TYPING INDICATOR ────────────────────────────────────────
    socket.on("typing", ({ conversationId, isTyping }) => {
      socket.to(`conversation:${conversationId}`).emit("userTyping", {
        userId,
        user: {
          name: socket.user.name || `${socket.user.firstName || ""} ${socket.user.lastName || ""}`.trim(),
          avatar: socket.user.avatar,
        },
        isTyping,
        conversationId,
      });
    });

    // ─── MARK AS READ ────────────────────────────────────────────
    socket.on("markRead", async ({ conversationId }) => {
      try {
        await prisma.message.updateMany({
          where: { conversationId: conversationId, senderId: { not: userId }, isRead: false },
          data: { isRead: true, readAt: new Date() }
        });
        await prisma.unreadCount.updateMany({
          where: { conversationId: conversationId, userId: userId },
          data: { count: 0 }
        });
        socket.to(`conversation:${conversationId}`).emit("messagesRead", { conversationId, readBy: userId });
      } catch (err) {
        console.error("markRead error:", err);
      }
    });

    // ─── GET ONLINE STATUS ───────────────────────────────────────
    socket.on("getOnlineStatus", ({ userIds }) => {
      const statuses = {};
      userIds.forEach((id) => { statuses[id] = onlineUsers.has(id); });
      socket.emit("onlineStatuses", statuses);
    });

    // ─── JOIN AUCTION ROOM ──────────────────────────────────────
    socket.on("joinAuction", ({ listingId }) => {
      socket.join(`auction:${listingId}`);
      console.log(`👤 User ${userId} joined auction room: ${listingId}`);
    });

    socket.on("leaveAuction", ({ listingId }) => {
      socket.leave(`auction:${listingId}`);
      console.log(`👤 User ${userId} left auction room: ${listingId}`);
    });

    // ─── DISCONNECT ──────────────────────────────────────────────
    socket.on("disconnect", () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          broadcastOnlineStatus(io, socket.user, false);
        }
      }
      console.log(`❌ Socket disconnected: ${socket.user.name || socket.user.email}`);
    });
  });
};

const broadcastOnlineStatus = async (io, user, isOnline) => {
  try {
    const userId = user.id;
    const conversations = await prisma.conversation.findMany({
      where: { participants: { some: { userId: userId } } },
      include: { participants: { select: { userId: true } } }
    });
    const otherUserIds = new Set();
    conversations.forEach((conv) => {
      conv.participants.forEach((p) => {
        const pid = p.userId;
        if (pid !== userId) otherUserIds.add(pid);
      });
    });
    otherUserIds.forEach((pid) => {
      io.to(`user:${pid}`).emit("userOnlineStatus", { userId, isOnline });
    });
  } catch (err) {
    console.error("broadcastOnlineStatus error:", err);
  }
};

export const isUserOnline = (userId) => onlineUsers.has(userId.toString());

export const getIo = () => io;
