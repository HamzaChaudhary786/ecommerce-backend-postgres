import cron from "node-cron";
import prisma from "../config/db.js";

const endExpiredAuctions = async () => {
  const now = new Date();
  const expiredListings = await prisma.listing.findMany({ where: { status: "active", listingType: { in: ["auction", "buy_it_now_auction"] }, auctionEndTime: { lte: now } } });
  if (expiredListings.length > 0) console.log(`[AuctionCron] Processing ${expiredListings.length} expired auctions...`);

  for (const listing of expiredListings) {
    try {
      if (listing.highestBidderId) {
        if (!listing.sellerId) { console.error(`[AuctionCron] Missing seller for listing ${listing.id}. Skipping.`); continue; }
        const order = await prisma.order.create({ data: { orderNumber: `ORD-${Date.now()}-${Math.floor(Math.random()*1000)}`, orderSource: "DIRECT_PRODUCT", buyerId: listing.highestBidderId, subtotal: listing.currentBid, shippingTotal: 0, total: listing.currentBid, isAuction: true, status: "payment_pending", paymentStatus: "pending", statusHistory: [{ status: "payment_pending", message: "Auction won." }], items: { create: [{ listingId: listing.id, sellerId: listing.sellerId, title: listing.title, image: listing.images?.[0]?.url || "", price: listing.currentBid, quantity: 1, shippingCost: 0 }] } } });
        await prisma.listing.update({ where: { id: listing.id }, data: { status: "sold", endTime: now } });
        await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: listing.highestBidderId, type: "auction_won", title: "You won the auction!", message: `Congratulations! You won "${listing.title}" with a bid of $${listing.currentBid}.`, link: `/order/${order.id}` } });
        await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: listing.sellerId, type: "listing_sold", title: "Your item sold via auction!", message: `"${listing.title}" sold for $${listing.currentBid}.`, link: `/order/${order.id}` } });

        const otherBidders = await prisma.bid.findMany({ where: { listingId: listing.id, bidderId: { not: listing.highestBidderId } }, select: { bidderId: true }, distinct: ["bidderId"] });
        for (const { bidderId } of otherBidders) {
          await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: bidderId, type: "auction_ended", title: "Auction ended", message: `The auction for "${listing.title}" has ended. You did not win this time.`, link: `/listing/${listing.id}` } });
        }
      } else {
        await prisma.listing.update({ where: { id: listing.id }, data: { status: "ended", endTime: now } });
        await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: listing.sellerId, type: "auction_ended", title: "Auction ended with no bids", message: `Your auction for "${listing.title}" ended with no bids.`, link: `/listing/${listing.id}` } });
      }
    } catch (err) { console.error(`[AuctionCron] Error processing listing ${listing.id}:`, err); }
  }
};

const checkPaymentTimeouts = async () => {
  const now = new Date();
  const deadline = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const expiredOrders = await prisma.order.findMany({ where: { isAuction: true, status: "payment_pending", createdAt: { lte: deadline } }, include: { items: true } });

  for (const order of expiredOrders) {
    try {
      console.log(`[AuctionCron] Order #${order.orderNumber} expired. Handling fallback...`);
      await prisma.order.update({ where: { id: order.id }, data: { status: "cancelled", statusHistory: [...(order.statusHistory || []), { status: "cancelled", message: "Automatic cancellation: Payment deadline expired.", timestamp: now }] } });
      await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: order.buyerId, type: "order_status_updated", title: "Order Cancelled - Payment Timeout", message: `Your order #${order.orderNumber} has been cancelled because payment was not received within 24 hours.` } });

      const listingId = order.items[0]?.listingId;
      if (!listingId) continue;
      const listing = await prisma.listing.findUnique({ where: { id: listingId } });
      const nextBid = await prisma.bid.findFirst({ where: { listingId, bidderId: { not: order.buyerId }, isRetracted: false }, orderBy: [{ amount: "desc" }, { createdAt: "desc" }] });

      if (nextBid) {
        console.log(`[AuctionCron] Offering listing ${listingId} to next bidder: ${nextBid.bidderId}`);
        const newOrder = await prisma.order.create({ data: { orderNumber: `ORD-${Date.now()}-${Math.floor(Math.random()*1000)}`, orderSource: "DIRECT_PRODUCT", buyerId: nextBid.bidderId, subtotal: nextBid.amount, shippingTotal: 0, total: nextBid.amount, isAuction: true, status: "payment_pending", paymentStatus: "pending", statusHistory: [{ status: "payment_pending", message: "Next highest bidder assigned." }], items: { create: [{ listingId: listing.id, sellerId: listing.sellerId, title: listing.title, image: listing.images?.[0]?.url || "", price: nextBid.amount, quantity: 1, shippingCost: 0 }] } } });
        await prisma.listing.update({ where: { id: listing.id }, data: { highestBidderId: nextBid.bidderId, currentBid: nextBid.amount } });
        await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: nextBid.bidderId, type: "auction_won", title: "Good news! You're now the winner!", message: `The previous winner failed to pay for "${listing.title}". It's now yours for $${nextBid.amount}. Please pay within 24 hours.`, link: `/order/${newOrder.id}` } });
      } else {
        console.log(`[AuctionCron] No more bidders for listing ${listingId}. Marking as ended.`);
        await prisma.listing.update({ where: { id: listingId }, data: { status: "ended" } });
      }
    } catch (err) { console.error(`[AuctionCron] Error handling fallback for order ${order.id}:`, err); }
  }
};

const notifyWatchersEndingSoon = async () => {
  const now = new Date();
  const oneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const endingSoon = await prisma.listing.findMany({ where: { status: "active", listingType: { in: ["auction", "buy_it_now_auction"] }, auctionEndTime: { gt: now, lte: oneHour }, endingSoonNotified: { not: true } } });

  for (const listing of endingSoon) {
    const watchers = listing.watchersList || [];
    for (const userId of watchers) {
      await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId, type: "watchlist_ending", title: "Ending Soon!", message: `An item in your watchlist "${listing.title}" is ending in less than an hour!`, link: `/listing/${listing.id}` } });
    }
    await prisma.listing.update({ where: { id: listing.id }, data: { endingSoonNotified: true } });
  }
};

cron.schedule("* * * * *", () => {
  endExpiredAuctions().catch(console.error);
  notifyWatchersEndingSoon().catch(console.error);
  checkPaymentTimeouts().catch(console.error);
});

export default { endExpiredAuctions, notifyWatchersEndingSoon };
