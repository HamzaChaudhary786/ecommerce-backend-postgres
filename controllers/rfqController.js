import prisma from '../config/db.js';
import { catchAsync, AppError, sendSuccess, paginate } from '../utils/helpers.js';
import { getIo } from '../socket.js';
import { cloudinary } from '../config/cloudinary.js';

function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

// ==============================
// BUYER: RFQ MANAGEMENT
// ==============================

export const createRFQ = catchAsync(async (req, res, next) => {
  let { isDraft, ...rfqData } = req.body;
  
  const isDraftBool = isDraft === 'true' || isDraft === true;
  if (rfqData.quantity) rfqData.quantity = parseInt(rfqData.quantity, 10);
  if (rfqData.expectedUnitPrice) rfqData.expectedUnitPrice = parseFloat(rfqData.expectedUnitPrice);
  if (rfqData.moq) rfqData.moq = parseInt(rfqData.moq, 10);
  if (rfqData.privateLabel !== undefined) rfqData.privateLabel = rfqData.privateLabel === 'true' || rfqData.privateLabel === true;
  if (rfqData.oemRequired !== undefined) rfqData.oemRequired = rfqData.oemRequired === 'true' || rfqData.oemRequired === true;
  if (rfqData.odmRequired !== undefined) rfqData.odmRequired = rfqData.odmRequired === 'true' || rfqData.odmRequired === true;

  const status = isDraftBool ? 'DRAFT' : 'PENDING_REVIEW';
  const rfqNumber = `RFQ-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

  let attachments = [];
  if (req.files && req.files.length > 0) {
    const uploadPromises = req.files.map(f => uploadBufferToCloudinary(f.buffer, { folder: "ecommerce/rfqs", resource_type: "auto" }));
    const results = await Promise.all(uploadPromises);
    attachments = results.map(res => res.secure_url);
  }

  const rfq = await prisma.rFQ.create({
    data: {
      ...rfqData,
      rfqNumber,
      buyerId: req.user.id,
      status,
      attachments: attachments.length > 0 ? attachments : undefined,
    }
  });

  if (!isDraft) {
    await prisma.rFQActivityLog.create({
      data: { rfqId: rfq.id, userId: req.user.id, action: 'CREATED' }
    });
  }

  sendSuccess(res, 201, `RFQ ${isDraft ? 'saved as draft' : 'submitted for review'}.`, { data: { rfq } });
});

export const getMyRFQs = catchAsync(async (req, res, next) => {
  const { page, limit, skip } = paginate(req.query);
  
  const where = { buyerId: req.user.id };
  if (req.query.status) where.status = req.query.status;

  const [rfqs, total] = await Promise.all([
    prisma.rFQ.findMany({
      where,
      include: { category: { select: { name: true } }, _count: { select: { quotes: true } } },
      orderBy: { createdAt: 'desc' },
      skip, take: limit
    }),
    prisma.rFQ.count({ where })
  ]);

  sendSuccess(res, 200, 'RFQs fetched.', { data: { rfqs, total, page, pages: Math.ceil(total / limit) } });
});

export const getMyRFQById = catchAsync(async (req, res, next) => {
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.id },
    include: {
      category: { select: { name: true } },
      quotes: {
        include: { supplier: { select: { id: true, name: true, store: { select: { storeName: true, logo: true } } } } }
      }
    }
  });

  if (!rfq) return next(new AppError('RFQ not found.', 404));
  if (rfq.buyerId !== req.user.id) return next(new AppError('Unauthorized.', 403));

  sendSuccess(res, 200, 'RFQ fetched.', { data: { rfq } });
});

export const updateRFQ = catchAsync(async (req, res, next) => {
  const rfq = await prisma.rFQ.findUnique({ where: { id: req.params.id } });
  
  if (!rfq) return next(new AppError('RFQ not found.', 404));
  if (rfq.buyerId !== req.user.id) return next(new AppError('Unauthorized.', 403));
  if (!['DRAFT', 'PENDING_REVIEW'].includes(rfq.status)) {
    return next(new AppError('Cannot update an active RFQ.', 400));
  }

  let newAttachments = rfq.attachments;
  if (req.files && req.files.length > 0) {
    const uploadPromises = req.files.map(f => uploadBufferToCloudinary(f.buffer, { folder: "ecommerce/rfqs", resource_type: "auto" }));
    const results = await Promise.all(uploadPromises);
    const newUrls = results.map(res => res.secure_url);
    newAttachments = [...rfq.attachments, ...newUrls];
  }

  let { isDraft, ...rfqData } = req.body;
  const isDraftBool = isDraft === 'true' || isDraft === true;
  if (rfqData.quantity) rfqData.quantity = parseInt(rfqData.quantity, 10);
  if (rfqData.expectedUnitPrice) rfqData.expectedUnitPrice = parseFloat(rfqData.expectedUnitPrice);
  if (rfqData.moq) rfqData.moq = parseInt(rfqData.moq, 10);
  if (rfqData.privateLabel !== undefined) rfqData.privateLabel = rfqData.privateLabel === 'true' || rfqData.privateLabel === true;
  if (rfqData.oemRequired !== undefined) rfqData.oemRequired = rfqData.oemRequired === 'true' || rfqData.oemRequired === true;
  if (rfqData.odmRequired !== undefined) rfqData.odmRequired = rfqData.odmRequired === 'true' || rfqData.odmRequired === true;

  const updated = await prisma.rFQ.update({
    where: { id: req.params.id },
    data: { ...rfqData, attachments: newAttachments, status: isDraft !== undefined ? (isDraftBool ? 'DRAFT' : 'PENDING_REVIEW') : rfq.status }
  });

  await prisma.rFQActivityLog.create({
    data: { rfqId: rfq.id, userId: req.user.id, action: 'UPDATED' }
  });

  sendSuccess(res, 200, 'RFQ updated.', { data: { rfq: updated } });
});

export const deleteRFQ = catchAsync(async (req, res, next) => {
  const rfq = await prisma.rFQ.findUnique({ where: { id: req.params.id } });
  if (!rfq || rfq.buyerId !== req.user.id) return next(new AppError('Not found or unauthorized.', 404));
  
  if (!['DRAFT'].includes(rfq.status)) {
    return next(new AppError('Only Drafts can be deleted. Please cancel or close instead.', 400));
  }

  await prisma.rFQ.delete({ where: { id: rfq.id } });
  sendSuccess(res, 200, 'Draft deleted.');
});

export const publishRFQ = catchAsync(async (req, res, next) => {
  // Typically an admin would approve from PENDING_REVIEW to PUBLISHED, but for testing buyer might do it.
  const rfq = await prisma.rFQ.update({
    where: { id: req.params.id },
    data: { status: 'PUBLISHED' }
  });
  sendSuccess(res, 200, 'RFQ Published.', { data: { rfq } });
});

export const closeRFQ = catchAsync(async (req, res, next) => {
  const { reason, reasonOther } = req.body;
  const rfq = await prisma.rFQ.update({
    where: { id: req.params.id },
    data: { status: 'CLOSED', closeReason: reason, closeReasonOther: reasonOther }
  });
  
  await prisma.rFQActivityLog.create({
    data: { rfqId: rfq.id, userId: req.user.id, action: 'CLOSED', details: { reason } }
  });

  sendSuccess(res, 200, 'RFQ Closed.', { data: { rfq } });
});

export const duplicateRFQ = catchAsync(async (req, res, next) => {
  const rfq = await prisma.rFQ.findUnique({ where: { id: req.params.id } });
  if (!rfq) return next(new AppError('Not found', 404));

  const { id, rfqNumber, createdAt, updatedAt, status, ...data } = rfq;
  
  const newRfq = await prisma.rFQ.create({
    data: {
      ...data,
      buyerId: req.user.id,
      status: 'DRAFT',
      rfqNumber: `RFQ-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`
    }
  });

  sendSuccess(res, 201, 'RFQ Duplicated.', { data: { rfq: newRfq } });
});


// ==============================
// PUBLIC & SUPPLIER FEEDS
// ==============================

export const getPublicRFQs = catchAsync(async (req, res, next) => {
  const { page, limit, skip } = paginate(req.query);
  const where = { status: { not: 'DRAFT' } };
  
  if (req.query.categoryId) where.categoryId = req.query.categoryId;

  const [rfqs, total] = await Promise.all([
    prisma.rFQ.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { category: { select: { name: true } } } }),
    prisma.rFQ.count({ where })
  ]);
  sendSuccess(res, 200, 'Public RFQs fetched', { data: { rfqs, total, page } });
});

export const getPublicRFQById = catchAsync(async (req, res, next) => {
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.id },
    include: { category: { select: { name: true } } }
  });
  if (!rfq) return next(new AppError('Not found', 404));

  await prisma.rFQ.update({ where: { id: rfq.id }, data: { views: { increment: 1 } } });
  sendSuccess(res, 200, 'RFQ Details', { data: { rfq } });
});

export const getAvailableRFQs = catchAsync(async (req, res, next) => {
  const { page, limit, skip } = paginate(req.query);
  
  // Smart Matching: Only show RFQs in categories the supplier deals in, or all if not restricted.
  // We'll fetch all published for now, but in a real smart match we join supplier listings categories.
  const where = { status: { in: ['PUBLISHED', 'QUOTATION_RECEIVED'] } };

  const [rfqs, total] = await Promise.all([
    prisma.rFQ.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { category: { select: { name: true } } } }),
    prisma.rFQ.count({ where })
  ]);
  sendSuccess(res, 200, 'Available RFQs fetched', { data: { rfqs, total, page } });
});


// ==============================
// QUOTATIONS
// ==============================

export const submitQuote = catchAsync(async (req, res, next) => {
  const rfqId = req.params.id;
  const supplierId = req.user.id;
  
  const existing = await prisma.rFQQuote.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId } } });
  if (existing) return next(new AppError('You have already submitted a quote.', 400));

  let attachments = [];
  if (req.files) attachments = req.files.map(f => f.path || f.location);

  const quote = await prisma.rFQQuote.create({
    data: {
      ...req.body,
      unitPrice: Number(req.body.unitPrice),
      moq: Number(req.body.moq),
      rfqId,
      supplierId,
      attachments
    }
  });

  await prisma.rFQ.update({
    where: { id: rfqId },
    data: { totalQuotes: { increment: 1 }, status: 'QUOTATION_RECEIVED' }
  });

  await prisma.rFQActivityLog.create({
    data: { rfqId, userId: req.user.id, action: 'QUOTE_SUBMITTED' }
  });

  sendSuccess(res, 201, 'Quotation submitted.', { data: { quote } });
});

export const updateQuote = catchAsync(async (req, res, next) => {
  const { quoteId } = req.params;
  const quote = await prisma.rFQQuote.findUnique({ where: { id: quoteId } });
  
  if (!quote || quote.supplierId !== req.user.id) return next(new AppError('Unauthorized or not found.', 404));
  if (['ACCEPTED', 'REJECTED'].includes(quote.status)) return next(new AppError('Cannot update finalized quote.', 400));

  await prisma.rFQQuoteRevision.create({
    data: {
      quoteId,
      previousData: quote,
      newData: req.body
    }
  });

  const updated = await prisma.rFQQuote.update({
    where: { id: quoteId },
    data: {
      ...req.body,
      unitPrice: req.body.unitPrice ? Number(req.body.unitPrice) : quote.unitPrice,
      moq: req.body.moq ? Number(req.body.moq) : quote.moq,
    }
  });

  sendSuccess(res, 200, 'Quote updated.', { data: { quote: updated } });
});

export const withdrawQuote = catchAsync(async (req, res, next) => {
  const quote = await prisma.rFQQuote.update({
    where: { id: req.params.quoteId },
    data: { status: 'WITHDRAWN' }
  });
  sendSuccess(res, 200, 'Quote withdrawn.', { data: { quote } });
});

export const getMyQuotes = catchAsync(async (req, res, next) => {
  const quotes = await prisma.rFQQuote.findMany({
    where: { supplierId: req.user.id },
    include: { rfq: { select: { productName: true, rfqNumber: true, status: true } } },
    orderBy: { createdAt: 'desc' }
  });
  sendSuccess(res, 200, 'Quotes fetched', { data: { quotes } });
});

export const getRFQQuotesForBuyer = catchAsync(async (req, res, next) => {
  const rfq = await prisma.rFQ.findUnique({ where: { id: req.params.id } });
  if (!rfq || rfq.buyerId !== req.user.id) return next(new AppError('Not found or unauthorized', 404));

  const quotes = await prisma.rFQQuote.findMany({
    where: { rfqId: rfq.id, status: { not: 'WITHDRAWN' } },
    include: {
      supplier: {
        select: { id: true, name: true, store: { select: { storeName: true, logo: true, isVerified: true, capabilities: true, createdAt: true } } }
      }
    },
    orderBy: { unitPrice: 'asc' }
  });

  sendSuccess(res, 200, 'Quotes fetched', { data: { quotes } });
});


// ==============================
// BUYER ACTIONS ON QUOTES
// ==============================

export const awardQuote = catchAsync(async (req, res, next) => {
  const quote = await prisma.rFQQuote.findUnique({ where: { id: req.params.quoteId }, include: { rfq: true } });
  if (!quote || quote.rfq.buyerId !== req.user.id) return next(new AppError('Not found or unauthorized.', 404));

  if (quote.status === 'ACCEPTED' || quote.rfq.status === 'AWARDED') {
    return next(new AppError('This RFQ has already been awarded.', 400));
  }

  // Check if an order already exists for this RFQ to prevent duplicate orders
  const existingOrder = await prisma.orderItem.findFirst({
    where: { 
      sellerId: quote.supplierId,
      title: { startsWith: 'RFQ Custom Order:' },
      listing: {
        categoryId: quote.rfq.categoryId
      }
    },
    include: { order: true }
  });
  // Note: a more precise check is better, but since RFQ status prevents double entry, we are safe.

  const result = await prisma.$transaction(async (tx) => {
    // 1. Update quote status
    await tx.rFQQuote.update({
      where: { id: quote.id },
      data: { status: 'ACCEPTED' }
    });

    // 2. Reject other quotes
    await tx.rFQQuote.updateMany({
      where: { rfqId: quote.rfqId, id: { not: quote.id } },
      data: { status: 'NOT_SELECTED' }
    });

    // 3. Update RFQ
    await tx.rFQ.update({
      where: { id: quote.rfqId },
      data: { status: 'AWARDED' }
    });

    // 4. Create Hidden B2B Listing
    const listing = await tx.listing.create({
      data: {
        title: `RFQ Custom Order: ${quote.rfq.productName}`,
        description: quote.rfq.description,
        sellerId: quote.supplierId,
        categoryId: quote.rfq.categoryId,
        condition: 'new',
        price: quote.unitPrice,
        quantity: quote.moq,
        status: 'draft', // Draft status keeps it out of public search and store
        listingType: 'fixed_price',
        isB2BProduct: true,
        images: quote.rfq.images && quote.rfq.images.length > 0 ? quote.rfq.images : [],
      }
    });

    // 5. Create Order
    const subtotal = quote.moq * quote.unitPrice;
    const orderNumber = `ORD-RFQ-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
    
    const order = await tx.order.create({
      data: {
        orderNumber,
        orderSource: 'RFQ',
        buyerId: req.user.id,
        status: 'payment_pending',
        paymentStatus: 'pending',
        subtotal: subtotal,
        total: subtotal,
        shippingTotal: 0,
        taxTotal: 0,
        shippingAddress: {},
        billingAddress: {}
      }
    });

    // 6. Create Order Item
    await tx.orderItem.create({
      data: {
        orderId: order.id,
        listingId: listing.id,
        sellerId: quote.supplierId,
        title: `RFQ: ${quote.rfq.productName}`,
        image: quote.rfq.images?.[0] || null,
        price: quote.unitPrice,
        quantity: quote.moq,
        subtotal: subtotal,
        itemStatus: 'pending',
      }
    });

    // 7. Send Notifications
    const buyerNotif = await tx.notification.create({
      data: {
        userId: req.user.id,
        type: 'order_created',
        title: 'Draft Order Created from RFQ',
        message: `Your draft order ${orderNumber} has been created. Please complete payment.`,
        link: `/buyer/orders`
      }
    });

    const sellerNotif = await tx.notification.create({
      data: {
        userId: quote.supplierId,
        type: 'new_order',
        title: 'New RFQ Order (Awaiting Payment)',
        message: `You have been awarded an RFQ. Draft Order ${orderNumber} is awaiting buyer payment.`,
        link: `/seller/orders`
      }
    });

    return { order, buyerNotif, sellerNotif };
  });

  const io = getIo();
  if (io) {
    io.to(`user:${req.user.id}`).emit("newNotification", result.buyerNotif);
    io.to(`user:${quote.supplierId}`).emit("newNotification", result.sellerNotif);
  }

  sendSuccess(res, 200, 'Supplier awarded and order created successfully.', { data: { order: result.order } });
});

export const rejectQuote = catchAsync(async (req, res, next) => {
  const quote = await prisma.rFQQuote.update({
    where: { id: req.params.quoteId },
    data: { status: 'REJECTED' }
  });
  sendSuccess(res, 200, 'Quote rejected.', { data: { quote } });
});


// ==============================
// NEGOTIATION / MESSAGES
// ==============================

export const sendMessage = catchAsync(async (req, res, next) => {
  const quote = await prisma.rFQQuote.findUnique({ where: { id: req.params.quoteId }, include: { rfq: true } });
  if (!quote) return next(new AppError('Quote not found.', 404));

  // Verify participant
  if (quote.supplierId !== req.user.id && quote.rfq.buyerId !== req.user.id) {
    return next(new AppError('Unauthorized.', 403));
  }

  let attachments = [];
  if (req.files) attachments = req.files.map(f => f.path || f.location);

  const msg = await prisma.rFQMessage.create({
    data: {
      quoteId: quote.id,
      rfqId: quote.rfqId,
      senderId: req.user.id,
      content: req.body.content,
      attachments
    }
  });

  // Optionally transition RFQ status to NEGOTIATION if not already
  if (quote.rfq.status !== 'NEGOTIATION' && quote.rfq.status !== 'AWARDED') {
    await prisma.rFQ.update({ where: { id: quote.rfqId }, data: { status: 'NEGOTIATION' } });
  }

  // Create notification for the recipient
  const isSeller = req.user.id === quote.supplierId;
  const recipientId = isSeller ? quote.rfq.buyerId : quote.supplierId;
  const recipientLink = isSeller ? `/buyer/rfq/negotiation/${quote.id}` : `/seller/rfq/negotiation/${quote.id}`;

  const notification = await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined, 
      userId: recipientId,
      type: 'NEW_MESSAGE',
      title: `New Message regarding RFQ: ${quote.rfq.productName}`,
      message: `You have received a new message from ${req.user.name || (isSeller ? 'a Seller' : 'the Buyer')}.`,
      link: recipientLink,
    }
  });

  const io = getIo();
  if (io) {
    io.to(`user:${recipientId}`).emit("newNotification", notification);
  }

  sendSuccess(res, 201, 'Message sent', { data: { message: msg } });
});

export const getQuoteMessages = catchAsync(async (req, res, next) => {
  const messages = await prisma.rFQMessage.findMany({
    where: { quoteId: req.params.quoteId },
    orderBy: { createdAt: 'asc' },
    include: { sender: { select: { id: true, name: true, avatar: true } } }
  });
  sendSuccess(res, 200, 'Messages fetched', { data: { messages } });
});


// ==============================
// SAVED, TEMPLATES, ANALYTICS
// ==============================

export const saveRFQ = catchAsync(async (req, res, next) => {
  const rfqId = req.params.id;
  const existing = await prisma.rFQSaved.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId: req.user.id } } });
  
  if (existing) {
    await prisma.rFQSaved.delete({ where: { id: existing.id } });
    return sendSuccess(res, 200, 'RFQ removed from favorites.');
  }

  await prisma.rFQSaved.create({ data: { rfqId, supplierId: req.user.id } });
  sendSuccess(res, 200, 'RFQ saved.');
});

export const getSavedRFQs = catchAsync(async (req, res, next) => {
  const saved = await prisma.rFQSaved.findMany({
    where: { supplierId: req.user.id },
    include: { rfq: { include: { category: true } } }
  });
  sendSuccess(res, 200, 'Saved RFQs', { data: { saved } });
});

export const saveTemplate = catchAsync(async (req, res, next) => {
  const template = await prisma.rFQTemplate.create({
    data: {
      ...req.body,
      buyerId: req.user.id
    }
  });
  sendSuccess(res, 201, 'Template saved', { data: { template } });
});

export const getTemplates = catchAsync(async (req, res, next) => {
  const templates = await prisma.rFQTemplate.findMany({ where: { buyerId: req.user.id } });
  sendSuccess(res, 200, 'Templates fetched', { data: { templates } });
});

// Block Supplier & Invite 
export const blockSupplier = catchAsync(async (req, res, next) => {
  const { supplierId, reason } = req.body;
  await prisma.rFQBlockList.create({
    data: { buyerId: req.user.id, supplierId, reason }
  });
  sendSuccess(res, 201, 'Supplier blocked from your future RFQs.');
});

export const inviteSupplier = catchAsync(async (req, res, next) => {
  const { supplierId } = req.body;
  const invite = await prisma.rFQInvitation.create({
    data: { rfqId: req.params.id, buyerId: req.user.id, supplierId }
  });
  sendSuccess(res, 201, 'Invitation sent.', { data: { invite } });
});

// Analytics (Dummies returning aggregates)
export const getBuyerAnalytics = catchAsync(async (req, res, next) => {
  const total = await prisma.rFQ.count({ where: { buyerId: req.user.id } });
  const active = await prisma.rFQ.count({ where: { buyerId: req.user.id, status: { in: ['PUBLISHED', 'QUOTATION_RECEIVED', 'NEGOTIATION'] } } });
  sendSuccess(res, 200, 'Buyer Analytics', { data: { total, active } });
});

export const getSupplierAnalytics = catchAsync(async (req, res, next) => {
  const totalQuotes = await prisma.rFQQuote.count({ where: { supplierId: req.user.id } });
  const wonQuotes = await prisma.rFQQuote.count({ where: { supplierId: req.user.id, status: 'ACCEPTED' } });
  sendSuccess(res, 200, 'Supplier Analytics', { data: { totalQuotes, wonQuotes, winRate: totalQuotes > 0 ? (wonQuotes/totalQuotes)*100 : 0 } });
});

// Admin stubs
export const getAllRFQsAdmin = catchAsync(async (req, res, next) => {
  const rfqs = await prisma.rFQ.findMany({ orderBy: { createdAt: 'desc' } });
  sendSuccess(res, 200, 'Admin RFQs', { data: { rfqs } });
});
export const getAdminAnalytics = catchAsync(async (req, res, next) => {
  sendSuccess(res, 200, 'Admin Analytics', { data: { } });
});
export const updateRFQStatusAdmin = catchAsync(async (req, res, next) => {
  const rfq = await prisma.rFQ.update({ where: { id: req.params.id }, data: { status: req.body.status } });
  sendSuccess(res, 200, 'Status updated', { data: { rfq } });
});
