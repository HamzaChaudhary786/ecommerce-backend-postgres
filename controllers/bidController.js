import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";
import { getIo } from "../socket.js";

function getMinIncrement(currentBid) {
  if (currentBid < 1) return 0.05;
  if (currentBid < 5) return 0.25;
  if (currentBid < 25) return 0.5;
  if (currentBid < 100) return 1.0;
  if (currentBid < 250) return 2.5;
  if (currentBid < 500) return 5.0;
  if (currentBid < 1000) return 10.0;
  if (currentBid < 2500) return 25.0;
  if (currentBid < 5000) return 50.0;
  return 100.0;
}

// POST /api/bids
export const placeBid = catchAsync(async (req, res, next) => {
  const { listingId, amount, maxAmount } = req.body;
  const userId = req.user.id;

  if (!listingId || !amount) return next(new AppError("Listing ID and bid amount are required.", 400));

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) return next(new AppError("Listing not found.", 404));
  if (listing.status !== "active") return next(new AppError("This listing is not active.", 400));
  if (listing.listingType === "fixed_price") return next(new AppError("This is a fixed-price listing.", 400));
  if (listing.sellerId === userId) return next(new AppError("You cannot bid on your own listing.", 403));
  if (listing.auctionEndTime < new Date()) return next(new AppError("This auction has ended.", 400));

  const bidAmount = Number(amount);
  const bidMax = maxAmount ? Number(maxAmount) : bidAmount;
  if (bidMax < bidAmount) return next(new AppError("Maximum bid cannot be less than current bid amount.", 400));

  const minIncrement = getMinIncrement(listing.currentBid || 0);
  const minRequired = listing.currentBid ? listing.currentBid + minIncrement : listing.startingBid;
  if (bidAmount < minRequired) return next(new AppError(`Minimum bid is $${minRequired.toFixed(2)}`, 400));

  const currentHighestBid = await prisma.bid.findFirst({ where: { listingId, isWinning: true } });

  let finalCurrentBid = bidAmount, finalWinnerId = userId, finalWinnerMax = bidMax;

  if (currentHighestBid) {
    const prevMax = currentHighestBid.maxAmount || currentHighestBid.amount;
    const prevBidder = currentHighestBid.bidderId;

    if (prevBidder === userId) {
      if (bidMax <= prevMax) return next(new AppError(`Your previous maximum bid was $${prevMax}. New max must be higher.`, 400));
      await prisma.bid.update({ where: { id: currentHighestBid.id }, data: { maxAmount: bidMax } });
      return sendSuccess(res, 200, "Maximum bid updated.", { data: { currentBid: listing.currentBid } });
    }

    if (bidMax > prevMax) {
      finalWinnerId = userId; finalWinnerMax = bidMax;
      finalCurrentBid = Math.min(bidMax, prevMax + getMinIncrement(prevMax));
      await prisma.bid.update({ where: { id: currentHighestBid.id }, data: { isWinning: false, status: "outbid" } });
      await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: prevBidder, type: "outbid", title: "You've been outbid!", message: `Someone outbid your maximum of $${prevMax} on "${listing.title}". Current bid: $${finalCurrentBid}`, link: `/listing/${listingId}` } });
    } else {
      finalWinnerId = prevBidder; finalWinnerMax = prevMax;
      finalCurrentBid = Math.min(prevMax, bidMax + getMinIncrement(bidMax));
      await prisma.bid.create({ data: { listingId, bidderId: userId, amount: bidAmount, maxAmount: bidMax, isWinning: false, status: "outbid" } });
      await prisma.listing.update({ where: { id: listingId }, data: { currentBid: finalCurrentBid, bidCount: { increment: 1 } } });
      return sendSuccess(res, 201, "You were immediately outbid by a proxy bid.", { data: { currentBid: finalCurrentBid, isWinner: false } });
    }
  }

  const newBid = await prisma.bid.create({
    data: { listingId, bidderId: finalWinnerId, amount: finalCurrentBid, maxAmount: finalWinnerMax, isAutoBid: finalWinnerMax > finalCurrentBid, isWinning: true, status: "active" },
  });

  const updateData = { currentBid: finalCurrentBid, highestBidderId: finalWinnerId, bidCount: { increment: 1 } };
  if (listing.autoExtend && listing.auctionEndTime) {
    const fiveMin = 5 * 60 * 1000;
    if (listing.auctionEndTime.getTime() - Date.now() < fiveMin) updateData.auctionEndTime = new Date(Date.now() + fiveMin);
  }
  const updatedListing = await prisma.listing.update({ where: { id: listingId }, data: updateData });

  const io = getIo();
  if (io) io.to(`auction:${listingId}`).emit("newBid", { listingId, currentBid: updatedListing.currentBid, bidCount: updatedListing.bidCount, highestBidder: finalWinnerId });

  sendSuccess(res, 201, "Bid placed successfully.", { data: { bid: newBid, currentBid: updatedListing.currentBid, bidCount: updatedListing.bidCount, isWinner: true } });
});

// GET /api/bids/listing/:listingId
export const getListingBids = catchAsync(async (req, res, next) => {
  const { page, limit, skip } = paginate(req.query);
  const listing = await prisma.listing.findUnique({ where: { id: req.params.listingId } });
  if (!listing) return next(new AppError("Listing not found.", 404));

  const [bids, total] = await Promise.all([
    prisma.bid.findMany({ where: { listingId: req.params.listingId, isRetracted: false }, include: { bidder: { select: { username: true, feedbackScore: true } } }, orderBy: [{ amount: "desc" }, { createdAt: "desc" }], skip, take: limit }),
    prisma.bid.count({ where: { listingId: req.params.listingId, isRetracted: false } }),
  ]);
  sendSuccess(res, 200, "Bids fetched.", { data: { bids, total, page, pages: Math.ceil(total / limit) } });
});

// GET /api/bids/my-bids
export const getMyBids = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = { bidderId: req.user.id };
  if (req.query.status) where.status = req.query.status;

  const [bids, total] = await Promise.all([
    prisma.bid.findMany({ where, include: { listing: { select: { title: true, images: true, currentBid: true, auctionEndTime: true, status: true, listingType: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.bid.count({ where }),
  ]);
  sendSuccess(res, 200, "Your bids fetched.", { data: { bids, total, page, pages: Math.ceil(total / limit) } });
});

// PATCH /api/bids/:id/retract
export const retractBid = catchAsync(async (req, res, next) => {
  const bid = await prisma.bid.findUnique({ where: { id: req.params.id }, include: { listing: true } });
  if (!bid) return next(new AppError("Bid not found.", 404));
  if (bid.bidderId !== req.user.id) return next(new AppError("You can only retract your own bids.", 403));
  if (bid.isRetracted) return next(new AppError("Bid already retracted.", 400));

  const hoursToEnd = (bid.listing.auctionEndTime - Date.now()) / (1000 * 60 * 60);
  const hoursSinceBid = (Date.now() - bid.createdAt.getTime()) / (1000 * 60 * 60);
  if (hoursToEnd < 12 && hoursSinceBid > 1) return next(new AppError("Cannot retract bid less than 12 hours before auction end.", 400));

  await prisma.bid.update({ where: { id: bid.id }, data: { isRetracted: true, isWinning: false, status: "retracted", retractionReason: req.body.reason || "Buyer requested retraction" } });

  const nextBid = await prisma.bid.findFirst({ where: { listingId: bid.listingId, isRetracted: false, bidderId: { not: bid.bidderId } }, orderBy: [{ amount: "desc" }, { createdAt: "asc" }] });

  if (nextBid) {
    await prisma.bid.update({ where: { id: nextBid.id }, data: { isWinning: true, status: "active" } });
    await prisma.listing.update({ where: { id: bid.listingId }, data: { currentBid: nextBid.amount, highestBidderId: nextBid.bidderId, bidCount: { decrement: 1 } } });
  } else {
    await prisma.listing.update({ where: { id: bid.listingId }, data: { currentBid: bid.listing.startingBid, highestBidderId: null, bidCount: { decrement: 1 } } });
  }

  sendSuccess(res, 200, "Bid retracted.", { data: { bid } });
});