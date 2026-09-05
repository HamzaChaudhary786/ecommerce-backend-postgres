import prisma from "../config/db.js";
import { getIo } from "../socket.js";

const NOTIFICATION_ROLE_MAP = {
  stock_update: "seller", listing_sold: "seller", listing_approved: "seller", listing_rejected: "seller",
  payment_received: "seller", offer_received: "seller", new_question: "seller", feedback_received: "seller", review_submitted: "seller",
  outbid: "buyer", auction_won: "buyer", order_placed: "buyer", order_shipped: "buyer", order_delivered: "buyer",
  order_status_updated: "buyer", offer_accepted: "buyer", offer_declined: "buyer", offer_countered: "buyer",
  wishlist_alert: "buyer", watchlist_ending: "buyer", price_drop: "buyer",
  message_received: "all", dispute_opened: "all", dispute_resolved: "all", return_request: "all",
  auction_ended: "all", question_answered: "all", review_approved: "all", review_rejected: "all",
  account_suspended: "all", system: "all",
};

export const sendNotification = async ({ user, senderId, type, title, message, link, data, targetRole }) => {
  try {
    const resolvedRole = targetRole || NOTIFICATION_ROLE_MAP[type] || "all";
    const notification = await prisma.notification.create({ data: { userId: user, senderId: senderId || null, type, title, message, link, data: data || undefined, targetRole: resolvedRole } });
    const io = getIo();
    if (io) io.to(`user:${user.toString()}`).emit("newNotification", notification);
    return notification;
  } catch (err) { console.error("Error in sendNotification:", err); }
};

export const triggerStockNotifications = async (listingId, oldQuantity, newQuantity) => {
  try {
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) return;

    let message = "", trigger = false;
    if (newQuantity === 0 && oldQuantity > 0) { message = `"${listing.title}" is now out of stock.`; trigger = true; }
    else if (newQuantity === 1 && oldQuantity > 1) { message = `Last item remaining for "${listing.title}"!`; trigger = true; }
    else if (newQuantity > 0 && newQuantity <= 3 && oldQuantity > 3) { message = `Only ${newQuantity} items left in stock for "${listing.title}".`; trigger = true; }
    else if (newQuantity > 0 && oldQuantity === 0) { message = `"${listing.title}" is back in stock!`; trigger = true; }

    if (trigger) {
      await sendNotification({ user: listing.sellerId, type: "stock_update", targetRole: "seller", title: "Stock Update", message, link: `/listings/${listingId}`, data: { listingId, quantity: newQuantity } });

      // Notify buyers who have item in cart
      const cartItems = await prisma.cartItem.findMany({ where: { listingId }, include: { cart: { select: { userId: true } } } });
      const cartUserIds = cartItems.map((ci) => ci.cart?.userId).filter((id) => id && id !== listing.sellerId);

      // Notify watchers (stored in listing.watchersList JSON or similar)
      const watcherIds = (listing.watchersList || []).filter((id) => id !== listing.sellerId);
      const buyerIds = [...new Set([...watcherIds, ...cartUserIds])];

      if (buyerIds.length > 0) {
        let buyerMessage = "";
        if (newQuantity === 0) buyerMessage = `An item you saved ("${listing.title}") is now out of stock.`;
        else if (newQuantity <= 3) buyerMessage = `Hurry! Only ${newQuantity} left of "${listing.title}" — grab it before it's gone!`;
        else if (oldQuantity === 0) buyerMessage = `Good news! "${listing.title}" is back in stock. Shop now!`;

        if (buyerMessage) {
          for (const userId of buyerIds) {
            await sendNotification({ user: userId, type: "wishlist_alert", targetRole: "buyer", title: newQuantity === 0 ? "Out of Stock" : newQuantity <= 3 ? "⚡ Almost Gone!" : "Back in Stock!", message: buyerMessage, link: `/listings/${listingId}`, data: { listingId, quantity: newQuantity } });
          }
        }
      }
    }
  } catch (err) { console.error("Error in triggerStockNotifications:", err); }
};
