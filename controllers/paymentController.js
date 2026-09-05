import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess, paginate, generateOrderNumber } from "../utils/helpers.js";
import stripeLib from "stripe";
import { generateEasyPaisaHash, generateJazzCashHash } from "../utils/paymentUtils.js";
import { processSellerPayouts } from "../utils/payoutUtils.js";
import { triggerStockNotifications } from "../utils/notificationUtils.js";
import { processRefundInternal } from "../utils/refundUtils.js";

const getStripe = () => stripeLib(process.env.STRIPE_MODE === "live" ? process.env.STRIPE_LIVE_SECRET_KEY : process.env.STRIPE_TEST_SECRET_KEY);

// POST /api/payments/create-intent
export const createPaymentIntent = catchAsync(async (req, res, next) => {
  const { orderId } = req.body;

  let order = await prisma.order.findUnique({ where: { id: orderId } });
  let isDraft = false;
  if (!order) { order = await prisma.draftOrder.findUnique({ where: { id: orderId } }); isDraft = true; }
  if (!order) return next(new AppError("Order not found.", 404));
  if (order.buyerId !== req.user.id) return next(new AppError("Not authorized.", 403));
  if (!isDraft && order.paymentStatus === "paid") return next(new AppError("Order is already paid.", 400));

  try {
    const stripe = getStripe();
    const pi = await stripe.paymentIntents.create({ amount: Math.round(order.total * 100), currency: "pkr", metadata: { orderId: order.id, isDraft: String(isDraft), userId: req.user.id }, automatic_payment_methods: { enabled: true } });
    sendSuccess(res, 200, "Payment intent created.", { data: { clientSecret: pi.client_secret, amount: order.total } });
  } catch (err) { return next(new AppError(err.message, 500)); }
});

// POST /api/payments/initiate-mobile
export const initiateMobilePayment = catchAsync(async (req, res, next) => {
  const { orderId, gateway } = req.body;
  let order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) order = await prisma.draftOrder.findUnique({ where: { id: orderId } });
  if (!order) return next(new AppError("Order not found.", 404));

  const amount = order.total.toString();
  const orderNumber = order.orderNumber || order.id.slice(-8).toUpperCase();

  if (gateway === "easypaisa") {
    const epData = { storeId: process.env.EP_STORE_ID, orderId: orderNumber, transactionAmount: amount, mobileAccountNo: req.body.mobileNumber || "", transactionType: "MA", tokenExpiry: "30", bankId: "", transactionDesc: `Order ${orderNumber}` };
    const hash = generateEasyPaisaHash(epData, process.env.EP_HASH_KEY);
    return sendSuccess(res, 200, "easypaisa payment initiated.", { data: { ...epData, hash, postUrl: process.env.EP_POST_URL || "https://easypay.easypaisa.com.pk/easypay/Index.js" } });
  } else if (gateway === "jazzcash") {
    const pp_Amount = Math.round(order.total * 100).toString();
    const pp_TxnDateTime = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const pp_TxnExpiryDateTime = new Date(Date.now() + 3600000).toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const jcData = { pp_Version: "1.1", pp_TxnType: "MWALLET", pp_Language: "EN", pp_MerchantID: process.env.JC_MERCHANT_ID, pp_SubMerchantID: "", pp_Password: process.env.JC_PASSWORD, pp_BankID: "TBANK", pp_ProductID: "RETL", pp_TxnRefNo: `T${pp_TxnDateTime}`, pp_Amount, pp_TxnCurrency: "PKR", pp_TxnDateTime, pp_BillReference: orderNumber, pp_Description: `Order ${orderNumber}`, pp_TxnExpiryDateTime, pp_ReturnURL: process.env.JC_RETURN_URL, pp_SecureHash: "", pp_MobileNumber: req.body.mobileNumber || "", pp_CNIC: req.body.cnic || "" };
    jcData.pp_SecureHash = generateJazzCashHash(jcData, process.env.JC_INTEGERITY_SALT);
    return sendSuccess(res, 200, "jazzcash payment initiated.", { data: { ...jcData, postUrl: process.env.JC_POST_URL || "https://sandbox.jazzcash.com.pk/CustomerPortal/transaction/Checkout" } });
  }
  return next(new AppError("Invalid mobile gateway specified.", 400));
});

// POST /api/payments/confirm
export const confirmPayment = catchAsync(async (req, res, next) => {
  const { orderId, paymentIntentId, gateway } = req.body;

  let pi = null;
  if (gateway === "stripe" || !gateway) {
    if (!paymentIntentId) return next(new AppError("Payment Intent ID is required for Stripe payments.", 400));
    const stripe = getStripe();
    try {
      pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (err) {
      return next(new AppError("Invalid Payment Intent ID.", 400));
    }
    if (!pi || pi.status !== "succeeded") return next(new AppError("Payment failed or not found.", 400));
  }

  // Check if this payment intent has already been used to confirm an order (Replay Attack Protection)
  if (paymentIntentId) {
    const existingPayment = await prisma.payment.findFirst({ 
      where: { gatewayPaymentIntentId: paymentIntentId },
      include: { orders: { include: { items: { include: { listing: true, seller: true } } } } }
    });

    if (existingPayment) {
      // If it already exists, the webhook probably got it first. Just return success.
      return sendSuccess(res, 200, "Payment already processed.", { 
        data: { 
          payment: existingPayment, 
          order: existingPayment.orders[0],
          orders: existingPayment.orders 
        } 
      });
    }
  }

  let order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: { include: { listing: true, seller: true } } } });
  let draft = null;
  if (!order) { draft = await prisma.draftOrder.findUnique({ where: { id: orderId } }); if (!draft) return next(new AppError("Order not found.", 404)); }

  const finalTotal = order ? order.total : draft.total;
  if (pi && pi.amount !== Math.round(finalTotal * 100)) return next(new AppError("Payment amount mismatch.", 400));

  const platformFeeRate = 0.1275, gatewayFeeRate = 0.029, gatewayFixed = 0.30;
  const platformFee = parseFloat((finalTotal * platformFeeRate).toFixed(2));
  const gatewayFee = parseFloat((finalTotal * gatewayFeeRate + gatewayFixed).toFixed(2));
  const sellerPayout = parseFloat((finalTotal - platformFee - gatewayFee).toFixed(2));

  if (draft) {
    // Group items by seller
    const sellerItemGroups = {};
    for (const item of draft.items) {
      const listing = await prisma.listing.findUnique({ where: { id: item.listingId || item.listing } });
      if (!listing) continue;
      const flash = item.flashSaleId ? await prisma.flashSale.findUnique({ where: { id: item.flashSaleId } }) : null;
      const price = item.price ?? (flash ? flash.flashSalePrice : listing.price) ?? 0;
      const shippingCost = item.shippingCost ?? 0;
      if (!sellerItemGroups[listing.sellerId]) sellerItemGroups[listing.sellerId] = [];
      sellerItemGroups[listing.sellerId].push({ listingId: listing.id, sellerId: listing.sellerId, title: item.title || listing.title, image: listing.images?.[0]?.url || "", price, quantity: item.quantity, variation: item.variation || null, shippingCost, subtotal: price * item.quantity, itemStatus: "paid", _listing: listing, _flash: flash });
    }

    const createdOrders = [];
    for (const [sId, groupItems] of Object.entries(sellerItemGroups)) {
      const storeSubtotal = groupItems.reduce((s, i) => s + i.subtotal, 0);
      const storeShipping = Math.max(...groupItems.map((i) => i.shippingCost));
      let storeDiscount = 0, couponCode = null;

      if (draft.appliedVouchers?.[sId]) {
        const v = draft.appliedVouchers[sId];
        const coupon = await prisma.coupon.findUnique({ where: { id: v.id } });
        if (coupon?.isActive) {
          if (coupon.type === "fixed_amount") storeDiscount = Math.min(coupon.value, storeSubtotal);
          else if (coupon.type === "percentage") { storeDiscount = (storeSubtotal * coupon.value) / 100; if (coupon.maxDiscountAmount) storeDiscount = Math.min(storeDiscount, coupon.maxDiscountAmount); }
          await prisma.coupon.update({ where: { id: coupon.id }, data: { usageCount: { increment: 1 }, usageHistory: [...(coupon.usageHistory || []), { user: req.user.id, discountAmount: storeDiscount, usedAt: new Date() }] } });
          couponCode = coupon.code;
        }
      }

      const storeTotal = parseFloat((storeSubtotal + storeShipping - storeDiscount).toFixed(2));
      const newOrder = await prisma.order.create({ data: { orderNumber: generateOrderNumber(), orderSource: "DIRECT_PRODUCT", buyerId: draft.buyerId, shippingAddress: draft.shippingAddress, billingAddress: draft.billingAddress || draft.shippingAddress, subtotal: storeSubtotal, shippingTotal: storeShipping, discountTotal: storeDiscount, total: storeTotal, couponCode, couponDiscount: storeDiscount, status: "paid", paymentStatus: "paid", paidAt: new Date(), statusHistory: [{ status: "paid", message: "Order confirmed via Split-Seller Checkout." }], items: { create: groupItems.map(({ _listing, _flash, ...rest }) => rest) } } });

      createdOrders.push(newOrder);
      for (const item of groupItems) {
        const oldQty = item._listing.quantity;
        const newQty = Math.max(0, oldQty - item.quantity);
        await prisma.listing.update({ where: { id: item._listing.id }, data: { quantity: newQty, quantitySold: { increment: item.quantity }, status: newQty <= 0 ? "sold" : undefined } });
        await triggerStockNotifications(item._listing.id, oldQty, newQty);
        if (item._flash) await prisma.flashSale.update({ where: { id: item._flash.id }, data: { flashSaleStock: { decrement: item.quantity } } });
      }
      await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: sId, type: "listing_sold", title: "New Order Received!", message: `You sold items in order #${newOrder.orderNumber}.`, link: `/seller/orders/${newOrder.id}` } });
    }

    await prisma.draftOrder.delete({ where: { id: draft.id } });
    const allOrderIds = createdOrders.map((o) => o.id);
    const payment = await prisma.payment.create({ data: { buyerId: req.user.id, amount: draft.total, currency: "PKR", status: "succeeded", gateway: req.body.gateway || "stripe", gatewayPaymentIntentId: paymentIntentId, platformFee, gatewayFee, sellerPayout, paidAt: new Date(), description: `Unified payment for ${Object.keys(sellerItemGroups).length} stores.`, orders: { connect: allOrderIds.map((id) => ({ id })) } } });
    // Payout is now held in escrow and handled upon delivery
    return sendSuccess(res, 200, "Payment confirmed and orders split by store.", { data: { payment, orders: createdOrders, order: createdOrders[0] } });
  }

  // Existing real order
  const updated = await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "paid", status: "paid", paidAt: new Date() } });
  const payment = await prisma.payment.create({ data: { buyerId: req.user.id, amount: order.total, currency: req.body.currency || "PKR", status: "succeeded", gateway: req.body.gateway || "stripe", gatewayPaymentIntentId: paymentIntentId, paidAt: new Date(), orders: { connect: [{ id: order.id }] } } });
  sendSuccess(res, 200, "Payment confirmed.", { data: { payment, order: updated } });
});

// GET /api/payments/history
export const getPaymentHistory = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({ where: { buyerId: req.user.id }, include: { orders: { select: { orderNumber: true, status: true, total: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.payment.count({ where: { buyerId: req.user.id } }),
  ]);
  sendSuccess(res, 200, "Payment history fetched.", { data: { payments, total, page, pages: Math.ceil(total / limit) } });
});

// GET /api/payments/connect-stripe
export const createConnectAccount = catchAsync(async (req, res, next) => {
  const stripe = getStripe();
  let store = await prisma.sellerStore.findUnique({ where: { sellerId: req.user.id } });
  if (!store) {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    store = await prisma.sellerStore.create({ data: { sellerId: req.user.id, storeName: `${req.user.username || req.user.name || "My"}'s Store`, storeSlug: `${req.user.username || "store"}-${randomSuffix}`.toLowerCase(), status: "approved" } });
    if (req.user.role === "buyer") await prisma.user.update({ where: { id: req.user.id }, data: { role: "seller", registeredSeller: true } });
  }

  let accountId = store.stripeConnectedAccountId;
  if (accountId) { try { await stripe.accounts.retrieve(accountId); } catch { accountId = null; await prisma.sellerStore.update({ where: { id: store.id }, data: { stripeConnectedAccountId: null, stripeOnboardingComplete: false } }); } }

  if (!accountId) {
    try {
      const account = await stripe.accounts.create({ type: "standard", email: req.user.email, business_type: "individual", metadata: { userId: req.user.id } });
      accountId = account.id;
      await prisma.sellerStore.update({ where: { id: store.id }, data: { stripeConnectedAccountId: accountId } });
    } catch (err) { return next(new AppError(`Stripe Account Creation Failed: ${err.message}`, 400)); }
  }

  const link = await stripe.accountLinks.create({ account: accountId, refresh_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/seller?stripe=refresh`, return_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/seller?stripe=success`, type: "account_onboarding" });
  sendSuccess(res, 200, "Onboarding link created.", { data: { url: link.url } });
});

// GET /api/payments/connect-status
export const getConnectStatus = catchAsync(async (req, res) => {
  const store = await prisma.sellerStore.findUnique({ where: { sellerId: req.user.id } });
  const isTestMode = process.env.STRIPE_MODE === "test";
  if (!store?.stripeConnectedAccountId) return sendSuccess(res, 200, "Not connected", { data: { isConnected: false, isTestMode } });

  const stripe = getStripe();
  let account;
  try { account = await stripe.accounts.retrieve(store.stripeConnectedAccountId); }
  catch { await prisma.sellerStore.update({ where: { id: store.id }, data: { stripeConnectedAccountId: null, stripeOnboardingComplete: false } }); return sendSuccess(res, 200, "Not connected", { data: { isConnected: false, isTestMode } }); }

  const isComplete = account.details_submitted && account.charges_enabled;
  if (isComplete && !store.stripeOnboardingComplete) await prisma.sellerStore.update({ where: { id: store.id }, data: { stripeOnboardingComplete: true } });

  res.setHeader("Cache-Control", "no-store"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
  sendSuccess(res, 200, "Connect status fetched", { data: { isConnected: isComplete, isTestMode, accountId: store.stripeConnectedAccountId, detailsSubmitted: account.details_submitted, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled, requirements: account.requirements?.currently_due || [], disabledReason: account.requirements?.disabled_reason || null } });
});

export const devBypassOnboarding = catchAsync(async (req, res, next) => {
  if (process.env.STRIPE_MODE !== "test") return next(new AppError("Bypass only allowed in test mode.", 403));
  const store = await prisma.sellerStore.findUnique({ where: { sellerId: req.user.id } });
  if (!store) return next(new AppError("Store not found.", 404));

  let accountId = store.stripeConnectedAccountId;
  if (!accountId) {
    try { const stripe = getStripe(); const acc = await stripe.accounts.create({ type: "standard", email: req.user.email, business_type: "individual", metadata: { userId: req.user.id, isDevBypass: "true" } }); accountId = acc.id; } catch (err) { console.error("[Dev Bypass] Account creation failed:", err.message); }
  }
  await prisma.sellerStore.update({ where: { id: store.id }, data: { stripeOnboardingComplete: true, ...(accountId && { stripeConnectedAccountId: accountId }) } });
  sendSuccess(res, 200, "Dev bypass successful.", { data: { accountId } });
});

// POST /api/payments/:id/refund
export const refundPayment = catchAsync(async (req, res, next) => {
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id }, include: { orders: true } });
  if (!payment) return next(new AppError("Payment not found.", 404));

  const { amount, reason } = req.body;
  
  const { updatedPayment, newStatus } = await processRefundInternal(
    payment, 
    amount, 
    reason, 
    req.user.id
  );

  if (payment.orders?.length > 0) {
    for (const order of payment.orders) {
      await prisma.order.update({ 
        where: { id: order.id }, 
        data: { 
          paymentStatus: newStatus === "refunded" ? "fully_refunded" : "partially_refunded", 
          ...(newStatus === "refunded" && { status: "refunded" }) 
        } 
      });
    }
    await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  
        userId: payment.buyerId, 
        type: "dispute_resolved", 
        title: "Refund Processed", 
        message: `A refund of PKR ${amount.toFixed(2)} has been processed for your order.`, 
        link: `/buyer/orders` 
      } 
    });
  }

  sendSuccess(res, 200, "Refund processed successfully.", { data: { payment: updatedPayment } });
});

// GET /api/payments/methods
export const getPaymentMethods = catchAsync(async (req, res) => {
  const methods = await prisma.paymentMethod.findMany({ where: { userId: req.user.id } });
  sendSuccess(res, 200, "Payment methods fetched.", { data: { methods } });
});

// POST /api/payments/methods
export const addPaymentMethod = catchAsync(async (req, res) => {
  if (req.body.isDefault) await prisma.paymentMethod.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
  const method = await prisma.paymentMethod.create({ data: { ...req.body, userId: req.user.id } });
  sendSuccess(res, 201, "Payment method added.", { data: { method } });
});

// DELETE /api/payments/methods/:id
export const deletePaymentMethod = catchAsync(async (req, res, next) => {
  const method = await prisma.paymentMethod.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!method) return next(new AppError("Payment method not found.", 404));
  await prisma.paymentMethod.delete({ where: { id: method.id } });
  sendSuccess(res, 200, "Payment method deleted.");
});

// PATCH /api/payments/methods/:id/default
export const setDefaultPaymentMethod = catchAsync(async (req, res, next) => {
  const method = await prisma.paymentMethod.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!method) return next(new AppError("Payment method not found.", 404));
  await prisma.paymentMethod.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
  const updated = await prisma.paymentMethod.update({ where: { id: method.id }, data: { isDefault: true } });
  sendSuccess(res, 200, "Default payment method updated.", { data: { method: updated } });
});

// GET /api/payments (admin)
export const getAllPayments = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({ where, include: { buyer: { select: { username: true, email: true } }, orders: { select: { orderNumber: true, total: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.payment.count({ where }),
  ]);
  sendSuccess(res, 200, "All payments fetched.", { data: { payments, total, page, pages: Math.ceil(total / limit) } });
});