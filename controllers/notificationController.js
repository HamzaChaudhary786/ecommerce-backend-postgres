import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";

// GET /api/notifications
export const getNotifications = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const { unreadOnly, type } = req.query;
  const userRole = req.user.role;

  const where = { userId: req.user.id };
  if (unreadOnly === "true") where.isRead = false;
  if (type) where.type = type;

  // Role-based filtering
  if (userRole === "seller") {
    where.OR = [{ targetRole: "seller" }, { targetRole: "all" }, { targetRole: null }];
  } else if (userRole === "buyer") {
    where.OR = [{ targetRole: "buyer" }, { targetRole: "all" }, { targetRole: null }];
  }
  // admins see everything

  const unreadWhere = { userId: req.user.id, isRead: false, ...(where.OR && { OR: where.OR }) };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, include: { sender: { select: { id: true, name: true, avatar: true, role: true, username: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: unreadWhere }),
  ]);

  sendSuccess(res, 200, "Notifications fetched.", { data: { notifications, total, unreadCount, page, pages: Math.ceil(total / limit) } });
});

// PATCH /api/notifications/:id/read
export const markAsRead = catchAsync(async (req, res, next) => {
  const notification = await prisma.notification.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!notification) return next(new AppError("Notification not found.", 404));

  const updated = await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true, readAt: new Date() } });
  sendSuccess(res, 200, "Notification marked as read.", { data: { notification: updated } });
});

// PATCH /api/notifications/mark-all-read
export const markAllAsRead = catchAsync(async (req, res) => {
  const result = await prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true, readAt: new Date() } });
  sendSuccess(res, 200, `${result.count} notifications marked as read.`);
});

// DELETE /api/notifications/:id
export const deleteNotification = catchAsync(async (req, res, next) => {
  const exists = await prisma.notification.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!exists) return next(new AppError("Notification not found.", 404));
  await prisma.notification.delete({ where: { id: req.params.id } });
  sendSuccess(res, 200, "Notification deleted.");
});

// DELETE /api/notifications
export const deleteAllNotifications = catchAsync(async (req, res) => {
  await prisma.notification.deleteMany({ where: { userId: req.user.id } });
  sendSuccess(res, 200, "All notifications deleted.");
});

// GET /api/notifications/unread-count
export const getUnreadCount = catchAsync(async (req, res) => {
  const userRole = req.user.role;
  const where = { userId: req.user.id, isRead: false };
  if (userRole === "seller") where.OR = [{ targetRole: "seller" }, { targetRole: "all" }, { targetRole: null }];
  else if (userRole === "buyer") where.OR = [{ targetRole: "buyer" }, { targetRole: "all" }, { targetRole: null }];
  const count = await prisma.notification.count({ where });
  sendSuccess(res, 200, "Unread count fetched.", { data: { unreadCount: count } });
});