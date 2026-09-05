import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess } from "../utils/helpers.js";

const getOrCreateCart = async (userId, sessionId) => {
  const where = userId ? { userId } : { sessionId };
  let cart = await prisma.cart.findFirst({ where, include: { items: { orderBy: { addedAt: 'asc' }, include: { listing: { include: { tierPrices: true, seller: { select: { username: true, feedbackScore: true, store: { select: { storeName: true, logo: true } } } } } } } } } });
  if (!cart) {
    cart = await prisma.cart.create({ data: { userId: userId || null, sessionId: sessionId || null, subtotal: 0 }, include: { items: { include: { listing: { include: { tierPrices: true, seller: { select: { username: true, feedbackScore: true, store: { select: { storeName: true, logo: true } } } } } } } } } });
  }
  return cart;
};

const calcSubtotal = (items) => items.filter((i) => !i.savedForLater).reduce((s, i) => s + i.price * i.quantity, 0);

// Helper function to process and return the enriched cart
const processAndReturnCart = async (cartId, res) => {
  const cart = await prisma.cart.findUnique({ where: { id: cartId }, include: { items: { orderBy: { addedAt: 'asc' }, include: { listing: { include: { tierPrices: true, seller: { select: { username: true, feedbackScore: true, store: { select: { storeName: true, logo: true } } } } } } } } } });
  if (!cart) return sendSuccess(res, 200, "Cart is empty", { data: { cart: null, itemCount: 0 } });
  
  const now = new Date();

  const enrichedItems = await Promise.all(cart.items.map(async (item) => {
    if (!item.listing) return { ...item, isAvailable: false };
    const flash = await prisma.flashSale.findFirst({ where: { listingId: item.listingId, status: { in: ["approved", "active"] }, flashSaleStock: { gt: 0 }, OR: [{ startTime: { lte: now } }, { startTime: null }], AND: [{ OR: [{ endTime: { gte: now } }, { endTime: null }] }] } });
    
    let basePrice = item.listing.price;
    if (item.listing.tierPrices && item.listing.tierPrices.length > 0) {
      const activeTier = item.listing.tierPrices.find(t => item.quantity >= t.minQty && (t.maxQty === null || item.quantity <= t.maxQty));
      if (activeTier) {
        basePrice = activeTier.price;
      } else {
        basePrice = item.listing.tierPrices[0]?.price || basePrice;
      }
    }

    let price = flash ? basePrice * (1 - flash.discountPercentage / 100) : basePrice;
    if (item.listing.dealDiscountPercent > 0 && !flash) price = price * (1 - item.listing.dealDiscountPercent / 100);
    if (Math.round((price + Number.EPSILON) * 100) / 100 !== item.price) {
      await prisma.cartItem.update({ where: { id: item.id }, data: { price: Math.round((price + Number.EPSILON) * 100) / 100 } });
      item.price = price;
    }
    const isAvailable = flash 
      ? flash.flashSaleStock >= item.quantity
      : item.listing.status === "active" && item.listing.quantity >= item.quantity;
    
    return { ...item, isAvailable };
  }));

  // Group items by seller
  const sellerGroups = {};
  enrichedItems.forEach(item => {
    if (item.savedForLater) return;
    const sellerId = item.listing?.sellerId || "unknown";
    if (!sellerGroups[sellerId]) {
      const sellerInfo = item.listing?.seller || {};
      sellerGroups[sellerId] = {
        sellerId,
        sellerName: sellerInfo.store?.storeName || sellerInfo.username || "Unknown Seller",
        sellerLogo: sellerInfo.store?.logo || "",
        items: [],
        storeSubtotal: 0
      };
    }
    sellerGroups[sellerId].items.push(item);
    sellerGroups[sellerId].storeSubtotal += item.price * item.quantity;
  });

  const subtotal = calcSubtotal(enrichedItems);
  const savedItems = enrichedItems.filter(i => i.savedForLater);

  await prisma.cart.update({ where: { id: cart.id }, data: { subtotal } });

  sendSuccess(res, 200, "Cart updated.", { 
    data: { 
      cart: { 
        ...cart, 
        items: enrichedItems,
        sellerGroups: Object.values(sellerGroups),
        savedItems,
        subtotal 
      }, 
      itemCount: enrichedItems.filter((i) => !i.savedForLater).length 
    } 
  });
};

// GET /api/cart
export const getCart = catchAsync(async (req, res) => {
  const cart = await getOrCreateCart(req.user?.id, req.headers["x-session-id"]);
  return processAndReturnCart(cart.id, res);
});

// POST /api/cart/add
export const addToCart = catchAsync(async (req, res, next) => {
  const { listingId, quantity = 1, variant } = req.body;
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, include: { tierPrices: true } });
  if (!listing) return next(new AppError("Listing not found.", 404));

  const now = new Date();
  const flash = await prisma.flashSale.findFirst({ where: { listingId, status: { in: ["approved", "active"] }, flashSaleStock: { gt: 0 }, OR: [{ startTime: { lte: now } }, { startTime: null }], AND: [{ OR: [{ endTime: { gte: now } }, { endTime: null }] }] } });

  if (!flash && listing.status !== "active") return next(new AppError("This item is not available.", 400));
  if (listing.listingType === "auction") return next(new AppError("Auction items cannot be added to cart.", 400));
  
  if (flash) {
    if (flash.flashSaleStock < quantity) return next(new AppError(`Only ${flash.flashSaleStock} item(s) available in flash sale.`, 400));
  } else {
    if (listing.quantity < quantity) return next(new AppError(`Only ${listing.quantity} item(s) available.`, 400));
  }
  let basePrice = listing.price;
  if (listing.tierPrices && listing.tierPrices.length > 0) {
    const activeTier = listing.tierPrices.find(t => quantity >= t.minQty && (t.maxQty === null || quantity <= t.maxQty));
    if (activeTier) {
      basePrice = activeTier.price;
    } else {
      basePrice = listing.tierPrices[0]?.price || basePrice;
    }
  }
  let price = flash ? basePrice * (1 - flash.discountPercentage / 100) : basePrice;

  const cart = await getOrCreateCart(req.user?.id, req.headers["x-session-id"]);

  const existing = cart.items.find((i) => i.listingId === listingId && JSON.stringify(i.variation) === JSON.stringify(variant || null));
  if (existing) {
    await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + Number(quantity) } });
  } else {
    await prisma.cartItem.create({ data: { cartId: cart.id, listingId, quantity: Number(quantity), variation: variant || undefined, price } });
  }

  return processAndReturnCart(cart.id, res);
});

// PATCH /api/cart/items/:itemId
export const updateCartItem = catchAsync(async (req, res, next) => {
  const quantity = Number(req.body.quantity);
  if (!quantity || quantity < 1) return next(new AppError("Quantity must be at least 1.", 400));
  const item = await prisma.cartItem.findUnique({ where: { id: req.params.itemId }, include: { listing: true } });
  if (!item) return next(new AppError("Item not found in cart.", 404));
  
  if (item.listing) {
    const now = new Date();
    const flash = await prisma.flashSale.findFirst({ where: { listingId: item.listingId, status: { in: ["approved", "active"] }, flashSaleStock: { gt: 0 }, OR: [{ startTime: { lte: now } }, { startTime: null }], AND: [{ OR: [{ endTime: { gte: now } }, { endTime: null }] }] } });
    if (flash) {
      if (quantity > flash.flashSaleStock) return next(new AppError(`Only ${flash.flashSaleStock} item(s) available in flash sale.`, 400));
    } else {
      if (quantity > item.listing.quantity) return next(new AppError(`Only ${item.listing.quantity} item(s) available.`, 400));
    }
  }

  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity, price: item.listing?.price || item.price } });
  return processAndReturnCart(item.cartId, res);
});

// DELETE /api/cart/items/:itemId
export const removeFromCart = catchAsync(async (req, res, next) => {
  const item = await prisma.cartItem.findUnique({ where: { id: req.params.itemId } });
  if (!item) return next(new AppError("Item not found in cart.", 404));
  await prisma.cartItem.delete({ where: { id: item.id } });
  return processAndReturnCart(item.cartId, res);
});

// PATCH /api/cart/items/:itemId/save-for-later
export const saveForLater = catchAsync(async (req, res, next) => {
  const item = await prisma.cartItem.findUnique({ where: { id: req.params.itemId } });
  if (!item) return next(new AppError("Item not found in cart.", 404));
  await prisma.cartItem.update({ where: { id: item.id }, data: { savedForLater: !item.savedForLater } });
  return processAndReturnCart(item.cartId, res);
});

// POST /api/cart/coupon
export const applyCoupon = catchAsync(async (req, res, next) => {
  const { code } = req.body;
  const now = new Date();
  const coupon = await prisma.coupon.findFirst({ where: { code: code.toUpperCase(), isActive: true } });
  if (!coupon) return next(new AppError("Invalid or expired coupon code.", 400));
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) return next(new AppError("Coupon usage limit reached.", 400));

  const cart = await getOrCreateCart(req.user?.id, req.headers["x-session-id"]);
  if (coupon.minOrderAmount && cart.subtotal < coupon.minOrderAmount) return next(new AppError(`Minimum order of $${coupon.minOrderAmount} required.`, 400));

  let discount = 0;
  if (coupon.type === "percentage") { discount = (cart.subtotal * coupon.value) / 100; if (coupon.maxDiscountAmount) discount = Math.min(discount, coupon.maxDiscountAmount); }
  else if (coupon.type === "fixed_amount") { discount = Math.min(coupon.value, cart.subtotal); }

  await prisma.cart.update({ where: { id: cart.id }, data: { coupon: code.toUpperCase() } });
  sendSuccess(res, 200, "Coupon applied.", { data: { discount: parseFloat(discount.toFixed(2)), couponType: coupon.type, cartSubtotal: cart.subtotal } });
});

// DELETE /api/cart/coupon
export const removeCoupon = catchAsync(async (req, res) => {
  const cart = await getOrCreateCart(req.user?.id, req.headers["x-session-id"]);
  await prisma.cart.update({ where: { id: cart.id }, data: { coupon: null } });
  sendSuccess(res, 200, "Coupon removed.", { data: { cart } });
});

// DELETE /api/cart
export const clearCart = catchAsync(async (req, res) => {
  const cart = await getOrCreateCart(req.user?.id, req.headers["x-session-id"]);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  await prisma.cart.update({ where: { id: cart.id }, data: { subtotal: 0, coupon: null } });
  sendSuccess(res, 200, "Cart cleared.");
});

// POST /api/cart/merge
export const mergeCart = catchAsync(async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return sendSuccess(res, 200, "Nothing to merge.");

  const guestCart = await prisma.cart.findFirst({ where: { sessionId }, include: { items: true } });
  if (!guestCart || guestCart.items.length === 0) return sendSuccess(res, 200, "Guest cart is empty.");

  const userCart = await getOrCreateCart(req.user.id, null);
  for (const gi of guestCart.items) {
    const ex = userCart.items.find((i) => i.listingId === gi.listingId);
    if (ex) { await prisma.cartItem.update({ where: { id: ex.id }, data: { quantity: ex.quantity + gi.quantity } }); }
    else { await prisma.cartItem.create({ data: { cartId: userCart.id, listingId: gi.listingId, quantity: gi.quantity, price: gi.price, variation: gi.variation || undefined } }); }
  }
  await prisma.cart.delete({ where: { id: guestCart.id } });
  return processAndReturnCart(userCart.id, res);
});