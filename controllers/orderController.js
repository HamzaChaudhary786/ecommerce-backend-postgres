import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess, paginate, generateOrderNumber, normalizeStatus, getCityCoordinates } from "../utils/helpers.js";
import { processSellerPayouts } from "../utils/payoutUtils.js";

// POST /api/orders
export const createOrder = catchAsync(async (req, res, next) => {
  const { items: inputItems, shippingAddress, billingAddress, paymentMethod, appliedVouchers } = req.body;

  if (!inputItems || inputItems.length === 0) {
    return next(new AppError("No items in order.", 400));
  }

  // 1. Fetch listing details for all items to ensure data integrity and security
  const listings = await prisma.listing.findMany({
    where: { id: { in: inputItems.map(i => i.listingId) } },
    select: {
      id: true,
      title: true,
      price: true,
      sellerId: true,
      images: true,
      shipping: true,
      quantity: true,
      status: true,
      tierPrices: true
    }
  });

  const listingMap = listings.reduce((acc, l) => {
    acc[l.id] = l;
    return acc;
  }, {});

  let subtotal = 0;
  const orderItemsData = [];

  for (const item of inputItems) {
    const listing = listingMap[item.listingId];

    if (!listing) {
      return next(new AppError(`Listing with ID ${item.listingId} not found.`, 404));
    }

    if (listing.status !== "active") {
      return next(new AppError(`Item "${listing.title}" is no longer active.`, 400));
    }

    if (listing.quantity < item.quantity) {
      return next(new AppError(`Insufficient stock for "${listing.title}". Max available: ${listing.quantity}`, 400));
    }

    let itemPrice = listing.price || 0;
    if (listing.tierPrices && listing.tierPrices.length > 0) {
      const activeTier = listing.tierPrices.find(t => item.quantity >= t.minQty && (t.maxQty === null || item.quantity <= t.maxQty));
      if (activeTier) {
        itemPrice = activeTier.price;
      } else {
        itemPrice = listing.tierPrices[0]?.price || itemPrice;
      }
    }
    const itemSubtotal = itemPrice * item.quantity;
    subtotal += itemSubtotal;

    orderItemsData.push({
      listingId: listing.id,
      sellerId: listing.sellerId,
      title: listing.title,
      image: (listing.images && Array.isArray(listing.images) && listing.images.length > 0) ? listing.images[0].url : null,
      price: itemPrice,
      quantity: item.quantity,
      variation: item.variant || null,
      itemStatus: "pending"
    });
  }

  // 2. Calculate totals
  // Shipping: simplified calculation (or accept from frontend with validation)
  const shippingTotal = req.body.shippingTotal || 0;

  // Verify subtotal meets minimum requirement (PKR 150 as per frontend)
  if (subtotal < 150) {
    return next(new AppError(`Order subtotal must be at least PKR 150. Current subtotal: PKR ${subtotal}`, 400));
  }

  // 3. Handle Applied Vouchers / Discounts (Integration placeholder)
  let discountTotal = 0;
  if (appliedVouchers && typeof appliedVouchers === 'object') {
    // Note: In a production environment, you should verify each voucher against the database
    // and recalculate the discount based on the store subtotal.
    // For now, we'll accept the discountTotal if sent, or keep it 0.
    discountTotal = req.body.discountTotal || 0;
  }

  const total = Math.max(0, subtotal + shippingTotal - discountTotal);

  // 4. Generate unique order number
  const orderNumber = generateOrderNumber();

  // 5. Create Order with atomic transaction
  const order = await prisma.order.create({
    data: {
      orderNumber,
      orderSource: "DIRECT_PRODUCT",
      buyerId: req.user.id,
      shippingAddress: shippingAddress || {},
      billingAddress: billingAddress || {},
      subtotal,
      shippingTotal,
      discountTotal,
      total,
      paymentMethod: paymentMethod || "stripe",
      status: "payment_pending",
      items: {
        create: orderItemsData
      }
    },
    include: { items: true }
  });

  // 6. Reduce inventory (In a real app, do this after payment or here with rollback mechanism)
  for (const item of inputItems) {
    await prisma.listing.update({
      where: { id: item.listingId },
      data: {
        quantity: { decrement: item.quantity },
        quantitySold: { increment: item.quantity }
      }
    });
  }

  sendSuccess(res, 201, "Order created successfully", { data: { order } });
});

export const getMyOrders = catchAsync(async (req, res, next) => {
  const orders = await prisma.order.findMany({
    where: { buyerId: req.user.id },
    include: { items: { include: { listing: true } } },
    orderBy: { createdAt: "desc" }
  });
  sendSuccess(res, 200, "Orders fetched", { data: { orders } });
});

// GET /api/orders/:id
export const getOrder = catchAsync(async (req, res, next) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      items: {
        include: {
          seller: { select: { id: true, username: true, email: true } },
          listing: true
        }
      },
      buyer: { select: { id: true, username: true, email: true } }
    }
  });

  if (!order) return next(new AppError("Order not found", 404));
  const isBuyer = order.buyerId === req.user.id;
  const isSeller = order.items.some(i => i.sellerId === req.user.id);

  if (!isBuyer && !isSeller && req.user.role !== "admin") {
    return next(new AppError("Not authorized", 403));
  }

  sendSuccess(res, 200, "Order fetched", { data: { order } });
});

// PATCH /api/orders/:id/address
export const updateOrderAddress = catchAsync(async (req, res, next) => {
  const { shippingAddress } = req.body;
  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: { shippingAddress }
  });
  sendSuccess(res, 200, "Address updated", { data: { order } });
});

// PATCH /api/orders/:id/cancel
export const cancelOrder = catchAsync(async (req, res, next) => {
  const { reason } = req.body;
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!order) return next(new AppError("Order not found.", 404));

  const isBuyer = order.buyerId === req.user.id;
  if (!isBuyer && req.user.role !== "admin") return next(new AppError("Not authorized.", 403));

  const updatedOrder = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
      cancellationReason: reason,
      statusHistory: { push: { status: "cancelled", timestamp: new Date(), message: "Order cancelled by buyer." } }
    }
  });
  sendSuccess(res, 200, "Order cancelled.", { data: { order: updatedOrder } });
});

// PATCH /api/orders/:orderId/items/:itemId/return
export const requestReturn = catchAsync(async (req, res, next) => {
  const { reason, description, images } = req.body;
  const item = await prisma.orderItem.update({
    where: { id: req.params.itemId },
    data: {
      itemStatus: "return_in_progress",
      returnStatus: "pending",
      returnReason: reason,
      returnDescription: description,
      returnImages: images || [],
      returnRequestedAt: new Date()
    }
  });
  sendSuccess(res, 200, "Return requested.", { data: { item } });
});

// GET /api/orders/seller/orders
export const getSellerOrders = catchAsync(async (req, res, next) => {
  const orders = await prisma.order.findMany({
    where: {
      items: { some: { sellerId: req.user.id } },
      status: { not: "payment_pending" }
    },
    include: {
      items: {
        where: { sellerId: req.user.id },
        include: { seller: { select: { id: true, username: true } }, listing: true }
      },
      buyer: { select: { username: true, email: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  sendSuccess(res, 200, "Seller orders fetched", { data: { orders } });
});

// GET /api/orders/seller/return-requests
export const getSellerReturnRequests = catchAsync(async (req, res, next) => {
  const items = await prisma.orderItem.findMany({
    where: { sellerId: req.user.id, returnStatus: { not: "none" } },
    include: { order: { include: { buyer: true } }, listing: true },
    orderBy: { returnRequestedAt: "desc" }
  });

  const requests = items.map(item => ({
    id: item.orderId,
    orderNumber: item.order.orderNumber,
    buyerData: {
      username: item.order.buyer?.username,
      email: item.order.buyer?.email
    },
    items: {
      ...item,
      returnRequest: {
        status: item.returnStatus,
        reason: item.returnReason,
        description: item.returnDescription,
        images: item.returnImages,
        requestedAt: item.returnRequestedAt,
        returnReceivedBySeller: item.returnReceivedBySeller,
        returnReceivedAt: item.returnReceivedAt
      }
    }
  }));

  sendSuccess(res, 200, "Return requests fetched", { data: { requests } });
});

// PATCH /api/orders/:orderId/items/:itemId/cancel
export const cancelOrderItem = catchAsync(async (req, res, next) => {
  const item = await prisma.orderItem.update({
    where: { id: req.params.itemId },
    data: { itemStatus: "cancelled", cancelledAt: new Date() }
  });
  sendSuccess(res, 200, "Item cancelled", { data: { item } });
});

// PATCH /api/orders/:orderId/items/:itemId/status
export const updateOrderItemStatus = catchAsync(async (req, res, next) => {
  const { status: rawStatus, trackingNumber, carrier } = req.body;
  const status = normalizeStatus(rawStatus);
  const data = { itemStatus: status };
  if (trackingNumber) data.trackingNumber = trackingNumber;
  if (carrier) data.shippingCarrier = carrier;

  if (status === "shipped") data.shippedAt = new Date();
  if (status === "delivered") data.actualDelivery = new Date();

  const item = await prisma.orderItem.update({
    where: { id: req.params.itemId },
    data
  });

  // If item is delivered, trigger payout for the order (Payout util handles item-wise logic if needed, but currently processes whole order)
  if (status === "delivered") {
    // In ShopVault, payoutUtils processes the entire order. We should check if ALL items are delivered.
    const parentOrder = await prisma.order.findUnique({ where: { id: req.params.orderId }, include: { items: true } });
    const allDelivered = parentOrder.items.every(i => i.itemStatus === "delivered");
    if (allDelivered && parentOrder.status !== "delivered") {
      await prisma.order.update({ where: { id: req.params.orderId }, data: { status: "delivered", statusHistory: { push: { status: "delivered", timestamp: new Date() } } } });
      await processSellerPayouts(req.params.orderId);
    }
  }

  sendSuccess(res, 200, "Status updated", { data: { item } });
});

// PATCH /api/orders/:orderId/status
export const updateFullOrderStatus = catchAsync(async (req, res, next) => {
  const { status: rawStatus } = req.body;
  const status = normalizeStatus(rawStatus);

  // Start a transaction to ensure both order and items are updated
  const [updated, _] = await prisma.$transaction([
    prisma.order.update({
      where: { id: req.params.orderId },
      data: {
        status,
        statusHistory: { push: { status, timestamp: new Date() } }
      },
      include: { items: true }
    }),
    prisma.orderItem.updateMany({
      where: { orderId: req.params.orderId },
      data: { itemStatus: status }
    })
  ]);

  if (status === "delivered") {
    await processSellerPayouts(req.params.orderId);
  }

  sendSuccess(res, 200, `Order updated to ${status}.`, { data: { order: updated } });
});

// PATCH /api/orders/:orderId/live-location
export const updateLiveLocation = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const { lat, lng, accuracy, timestamp } = req.body;

  if (!lat || !lng) return next(new AppError("Latitude and Longitude are required.", 400));

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return next(new AppError("Order not found.", 404));

  const isInvolved = order.items.some((i) => i.sellerId === req.user.id);
  if (!isInvolved && req.user.role !== "admin") return next(new AppError("Not authorized.", 403));

  if (["delivered", "cancelled", "refunded"].includes(order.status)) {
    return next(new AppError("Location cannot be updated for delivered or cancelled orders.", 400));
  }

  // Update live location only for items belonging to the requesting seller/courier
  const myItems = order.items.filter((i) => i.sellerId === req.user.id || req.user.role === "admin");

  const now = timestamp ? new Date(timestamp) : new Date();

  for (const item of myItems) {
    if (["shipped", "out_for_delivery", "in_transit"].includes(item.itemStatus)) {
      await prisma.orderItem.update({
        where: { id: item.id },
        data: {
          courierCurrentLat: lat,
          courierCurrentLng: lng,
          courierAccuracy: accuracy,
          courierLocationUpdatedAt: now
        }
      });
    }
  }

  sendSuccess(res, 200, "Live location updated.");
});

// PATCH /api/orders/:orderId/items/:itemId/confirm-return
export const confirmReturnReceived = catchAsync(async (req, res, next) => {
  const item = await prisma.orderItem.update({
    where: { id: req.params.itemId },
    data: { returnReceivedBySeller: true, returnReceivedAt: new Date() }
  });
  sendSuccess(res, 200, "Return received confirmed", { data: { item } });
});

// GET /api/orders
export const getAllOrders = catchAsync(async (req, res, next) => {
  const { page, limit, skip } = paginate(req.query);
  
  const where = {};
  if (req.query.status && req.query.status !== "all") where.status = req.query.status;
  if (req.query.paymentStatus && req.query.paymentStatus !== "all") where.paymentStatus = req.query.paymentStatus;
  if (req.query.orderSource && req.query.orderSource !== "all") where.orderSource = req.query.orderSource;
  
  if (req.query.search) {
    where.OR = [
      { orderNumber: { contains: req.query.search, mode: "insensitive" } },
      { buyer: { name: { contains: req.query.search, mode: "insensitive" } } },
      { buyer: { username: { contains: req.query.search, mode: "insensitive" } } },
      { items: { some: { seller: { name: { contains: req.query.search, mode: "insensitive" } } } } },
      { items: { some: { seller: { username: { contains: req.query.search, mode: "insensitive" } } } } }
    ];
  }

  const [orders, total, totalOrders, pendingPayment, processing, completed, cancelled, revenueResult] = await Promise.all([
    prisma.order.findMany({ 
      where, 
      include: { 
        buyer: true, 
        items: { include: { seller: true, listing: true } } 
      }, 
      orderBy: { createdAt: "desc" }, 
      skip, 
      take: limit 
    }),
    prisma.order.count({ where }),
    prisma.order.count(),
    prisma.order.count({ where: { paymentStatus: "pending" } }),
    prisma.order.count({ where: { status: "processing" } }),
    prisma.order.count({ where: { status: "delivered" } }),
    prisma.order.count({ where: { status: "cancelled" } }),
    prisma.order.aggregate({ _sum: { total: true }, where: { paymentStatus: "paid" } })
  ]);

  const stats = {
    totalOrders,
    pendingPayment,
    processing,
    completed,
    cancelled,
    totalRevenue: revenueResult._sum.total || 0
  };

  sendSuccess(res, 200, "All orders fetched.", { data: { orders, total, page, pages: Math.ceil(total / limit), stats } });
});

// GET /api/orders/admin/return-requests
export const getReturnRequests = catchAsync(async (req, res, next) => {
  const items = await prisma.orderItem.findMany({
    where: { returnStatus: { not: "none" } },
    include: { order: { include: { buyer: true } }, listing: true },
    orderBy: { returnRequestedAt: "desc" }
  });

  const requests = items.map(item => ({
    id: item.orderId,
    orderNumber: item.order.orderNumber,
    buyerData: {
      username: item.order.buyer?.username,
      email: item.order.buyer?.email
    },
    items: {
      ...item,
      returnRequest: {
        status: item.returnStatus,
        reason: item.returnReason,
        description: item.returnDescription,
        images: item.returnImages,
        requestedAt: item.returnRequestedAt,
        returnReceivedBySeller: item.returnReceivedBySeller,
        returnReceivedAt: item.returnReceivedAt
      }
    }
  }));

  sendSuccess(res, 200, "Return requests fetched", { data: { requests } });
});

// PATCH /api/orders/:orderId/items/:itemId/return-status
export const updateReturnStatus = catchAsync(async (req, res, next) => {
  const { status, reason } = req.body;
  const item = await prisma.orderItem.update({
    where: { id: req.params.itemId },
    data: { returnStatus: status, returnRejectionReason: reason, returnDecidedAt: new Date() }
  });
  sendSuccess(res, 200, "Return status updated", { data: { item } });
});

// PATCH /api/orders/:orderId/items/:itemId/complete-refund
export const completeRefund = catchAsync(async (req, res, next) => {
  const item = await prisma.orderItem.update({
    where: { id: req.params.itemId },
    data: { 
      returnRefundStatus: "completed",
      returnStatus: "refunded",
      itemStatus: "refunded"
    }
  });
  sendSuccess(res, 200, "Refund completed", { data: { item } });
});

// GET /api/orders/:orderId/items/:itemId/tracking
export const getItemTracking = catchAsync(async (req, res, next) => {
  const { orderId, itemId } = req.params;
  const item = await prisma.orderItem.findUnique({
    where: { id: itemId },
    include: {
      order: true,
      listing: true,
      seller: { include: { addresses: { where: { isDefault: true } } } }
    }
  });

  if (!item || item.orderId !== orderId) return next(new AppError("Item not found.", 404));
  if (item.order.buyerId !== req.user.id && item.sellerId !== req.user.id && req.user.role !== "admin") {
    return next(new AppError("Not authorized.", 403));
  }

  const rawStatus = item.itemStatus;
  let status = normalizeStatus(rawStatus);

  // Fallback to order status if item status is still pending but order is shipped/out_for_delivery
  if (status === "pending" || status === "paid" || status === "processing" || status === "processed") {
    const orderStatus = normalizeStatus(item.order.status);
    if (["shipped", "out_for_delivery", "delivered"].includes(orderStatus)) {
      status = orderStatus;
    }
  }

  const isShipped = ["shipped", "in_transit", "out_for_delivery", "delivered"].includes(status);

  let gpsAvailable = false;
  let mapData = null;
  let distance = null;

  if (isShipped) {
    // Get Origin (Seller's City)
    const sellerLoc = item.listing?.location || {};
    const sellerCity = (typeof sellerLoc === 'object' ? sellerLoc.city : null) ||
      (item.seller?.addresses?.[0]?.city) ||
      "Sahiwal"; // Default to Sahiwal as per user request if not found

    // Get Destination (Buyer's City)
    const buyerAddr = item.order.shippingAddress || {};
    const buyerCity = buyerAddr.city || "Lahore";

    const origin = getCityCoordinates(sellerCity);
    const destination = getCityCoordinates(buyerCity);

    // Provide default route points (curved line) as fallback
    let routePoints = [
      origin,
      [(origin[0] + destination[0]) / 2 + 0.05, (origin[1] + destination[1]) / 2 - 0.05],
      destination
    ];
    let routeDistance = 12.5; // default fallback km
    let routeDuration = 15; // default fallback mins

    // Attempt to fetch real road route from OSRM
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${origin[1]},${origin[0]};${destination[1]},${destination[0]}?overview=full&geometries=geojson`;

      const response = await fetch(osrmUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      const routeData = await response.json();

      if (routeData.code === "Ok" && routeData.routes && routeData.routes.length > 0) {
        const route = routeData.routes[0];
        // OSRM returns coordinates as [lng, lat], we need [lat, lng]
        routePoints = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
        routeDistance = Math.round((route.distance / 1000) * 10) / 10;
        routeDuration = Math.round(route.duration / 60);
      }
    } catch (routeErr) {
      if (routeErr.name === 'AbortError') {
        console.warn("[Tracking] OSRM Route Request Timed Out");
      } else {
        console.error("[Tracking] OSRM Route Error:", routeErr.message);
      }
      // Fallback already set above
    }

    // Check if we have real live GPS data from the courier
    const hasLiveGPS = item.courierCurrentLat !== null && item.courierCurrentLng !== null;
    gpsAvailable = hasLiveGPS || status === "out_for_delivery" || status === "delivered";

    let currentLocation = origin;

    if (hasLiveGPS) {
      currentLocation = [item.courierCurrentLat, item.courierCurrentLng];
    } else {
      // Fallback to simulated location based on status
      if (status === "in_transit") {
        // Find midpoint in route points array
        const midIdx = Math.floor(routePoints.length / 2);
        currentLocation = routePoints[midIdx] || origin;
      }
      if (status === "out_for_delivery") {
        // Closer to destination (80% through the route points)
        const targetIdx = Math.floor(routePoints.length * 0.8);
        currentLocation = routePoints[targetIdx] || destination;
      }
      if (status === "delivered") currentLocation = destination;
    }

    const destinationLabel = buyerAddr.street ? `${buyerAddr.street}, ${buyerCity}` : `${buyerCity} Delivery`;
    const originLabel = `${sellerCity} Hub`;

    mapData = {
      origin, destination, currentLocation, destinationLabel, originLabel,
      routePoints,
      isLive: hasLiveGPS
    };

    if (status === "out_for_delivery") {
      distance = { totalKm: routeDistance, riderToDestinationKm: Math.round(routeDistance * 0.2 * 10) / 10, estimatedMinutes: Math.round(routeDuration * 0.2), progress: 82 };
    } else if (status === "delivered") {
      distance = { totalKm: routeDistance, riderToDestinationKm: 0, estimatedMinutes: 0, progress: 100 };
    }
  }

  sendSuccess(res, 200, "Tracking fetched", {
    data: {
      trackingNumber: item.trackingNumber,
      carrier: item.shippingCarrier,
      statusHistory: item.statusHistory,
      estimatedDelivery: item.estimatedDelivery,
      gpsAvailable,
      mapData,
      distance
    }
  });
});

// Force restart nodemon: updated Prisma Client types
