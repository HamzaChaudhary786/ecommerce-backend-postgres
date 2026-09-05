import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";
import prisma from "../config/db.js";
import { getIo } from "../socket.js";

// POST /api/inquiries
export const createInquiry = catchAsync(async (req, res, next) => {
  const { listingId, quantity, message } = req.body;
  const buyerId = req.user.id;

  if (!listingId || !quantity || !message) {
    return next(new AppError("Please provide listingId, quantity, and message", 400));
  }

  if (quantity < 1) {
    return next(new AppError("Quantity must be a positive number", 400));
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true, id: true, title: true }
  });

  if (!listing) {
    return next(new AppError("Product not found.", 404));
  }

  if (listing.sellerId === buyerId) {
    return next(new AppError("You cannot submit an inquiry for your own product.", 400));
  }

  const inquiry = await prisma.b2BInquiry.create({
    data: {
      id: "INQ-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase(),
      listingId: listing.id,
      buyerId,
      sellerId: listing.sellerId,
      quantity: Number(quantity),
      message,
      status: "PENDING",
      updatedAt: new Date()
    }
  });

  // Create simple notification for seller
  const notification = await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined, 
      userId: listing.sellerId,
      targetRole: "seller",
      type: "inquiry",
      title: "New B2B Inquiry",
      message: `You received a new quote request for ${listing.title}`,
      link: "/seller/inquiries"
    }
  });

  const io = getIo();
  if (io) {
    io.to(`user:${listing.sellerId}`).emit("newNotification", notification);
  }

  sendSuccess(res, 201, "Inquiry submitted successfully.", { data: { inquiry } });
});

// GET /api/inquiries/my-inquiries
export const getMyInquiries = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);

  const [inquiries, total] = await Promise.all([
    prisma.b2BInquiry.findMany({
      where: { buyerId: req.user.id },
      include: {
        Listing: { select: { title: true, images: true } },
        User_B2BInquiry_sellerIdToUser: { select: { name: true, store: { select: { storeName: true } } } }
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit
    }),
    prisma.b2BInquiry.count({ where: { buyerId: req.user.id } })
  ]);

  sendSuccess(res, 200, "Your inquiries fetched.", {
    data: { inquiries, total, page, pages: Math.ceil(total / limit) }
  });
});

// GET /api/inquiries/seller-inquiries
export const getSellerInquiries = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);

  const [inquiries, total] = await Promise.all([
    prisma.b2BInquiry.findMany({
      where: { sellerId: req.user.id },
      include: {
        Listing: { select: { id: true, title: true, images: true } },
        User_B2BInquiry_buyerIdToUser: { select: { id: true, name: true, email: true, businessType: true } }
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit
    }),
    prisma.b2BInquiry.count({ where: { sellerId: req.user.id } })
  ]);

  sendSuccess(res, 200, "Seller inquiries fetched.", {
    data: { inquiries, total, page, pages: Math.ceil(total / limit) }
  });
});

// PATCH /api/inquiries/:id/status
export const updateInquiryStatus = catchAsync(async (req, res, next) => {
  const { status } = req.body;

  if (!["PENDING", "RESPONDED", "CLOSED"].includes(status)) {
    return next(new AppError("Invalid status. Must be PENDING, RESPONDED, or CLOSED.", 400));
  }

  const existingInquiry = await prisma.b2BInquiry.findUnique({
    where: { id: req.params.id }
  });

  if (!existingInquiry) {
    return next(new AppError("Inquiry not found.", 404));
  }

  if (existingInquiry.sellerId !== req.user.id) {
    return next(new AppError("You can only update inquiries for your own products.", 403));
  }

  const updatedInquiry = await prisma.b2BInquiry.update({
    where: { id: req.params.id },
    data: { status, updatedAt: new Date() }
  });

  sendSuccess(res, 200, "Inquiry status updated.", { data: { inquiry: updatedInquiry } });
});
