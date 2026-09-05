import prisma from "../config/db.js";
import stripeLib from "stripe";
import { processSellerPayouts } from "../utils/payoutUtils.js";

const getStripe = () => stripeLib(process.env.STRIPE_MODE === "live" ? process.env.STRIPE_LIVE_SECRET_KEY : process.env.STRIPE_TEST_SECRET_KEY);

export const handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try { event = getStripe().webhooks.constructEvent(req.body, sig, endpointSecret); }
  catch (err) { console.error(`[Stripe Webhook] Error: ${err.message}`); return res.status(400).send(`Webhook Error: ${err.message}`); }

  switch (event.type) {
    case "payment_intent.succeeded":
      await handleSuccessfulPayment(event.data.object);
      break;
    case "payment_intent.payment_failed":
      console.log(`[Stripe Webhook] Payment failed: ${event.data.object.id}`);
      break;
    default:
      console.log(`[Stripe Webhook] Unhandled event type ${event.type}`);
  }
  res.json({ received: true });
};

async function handleSuccessfulPayment(paymentIntent) {
  const { orderId, isDraft, userId } = paymentIntent.metadata;
  if (!orderId) return;

  const { triggerStockNotifications } = await import("../utils/notificationUtils.js");

  let order = await prisma.order.findUnique({ where: { id: orderId } });
  let draft = null;
  if (!order && isDraft === "true") draft = await prisma.draftOrder.findUnique({ where: { id: orderId } });
  if (!order && !draft) { console.error(`[Webhook] Order ${orderId} not found.`); return; }
  if (order?.paymentStatus === "paid") return;

  const finalTotal = order ? order.total : draft.total;
  const platformFeeRate = 0.1275, gatewayFeeRate = 0.029, gatewayFixed = 0.30;
  const platformFee = parseFloat((finalTotal * platformFeeRate).toFixed(2));
  const gatewayFee = parseFloat((finalTotal * gatewayFeeRate + gatewayFixed).toFixed(2));
  const sellerPayout = parseFloat((finalTotal - platformFee - gatewayFee).toFixed(2));

  if (draft) {
    const orderItemsData = [];
    for (const item of draft.items) {
      const listing = await prisma.listing.findUnique({ where: { id: item.listingId || item.listing } });
      if (!listing) continue;
      const flash = item.flashSaleId ? await prisma.flashSale.findUnique({ where: { id: item.flashSaleId } }) : null;
      const price = flash ? flash.flashSalePrice : listing.price;
      const shippingCost = 0;
      orderItemsData.push({ listingId: listing.id, sellerId: listing.sellerId, title: listing.title, image: listing.images?.[0]?.url || "", price, quantity: item.quantity, variation: item.variation || null, shippingCost, subtotal: price * item.quantity, itemStatus: "paid" });

      const oldQty = listing.quantity;
      const newQty = Math.max(0, oldQty - item.quantity);
      await prisma.listing.update({ where: { id: listing.id }, data: { quantity: newQty, quantitySold: { increment: item.quantity }, status: newQty <= 0 ? "sold" : undefined } });
      triggerStockNotifications(listing.id, oldQty, newQty);
      if (flash) await prisma.flashSale.update({ where: { id: flash.id }, data: { flashSaleStock: { decrement: item.quantity } } });
    }

    let discountTotal = draft.discountTotal || 0;
    const couponCodes = [];
    if (draft.appliedVouchers) {
      for (const [, voucher] of Object.entries(draft.appliedVouchers)) {
        if (voucher?.id) {
          const coupon = await prisma.coupon.findUnique({ where: { id: voucher.id } });
          if (coupon) {
            await prisma.coupon.update({ where: { id: coupon.id }, data: { usageCount: { increment: 1 }, usageHistory: [...(coupon.usageHistory || []), { user: userId, discountAmount: voucher.value, usedAt: new Date() }] } });
            couponCodes.push(coupon.code);
          }
        }
      }
    }

    order = await prisma.order.create({ data: { orderSource: "DIRECT_PRODUCT", buyerId: draft.buyerId, shippingAddress: draft.shippingAddress, billingAddress: draft.billingAddress || draft.shippingAddress, subtotal: draft.subtotal, shippingTotal: draft.shippingTotal, taxTotal: draft.taxTotal || 0, discountTotal, couponDiscount: discountTotal, couponCode: couponCodes.join(", ") || null, total: draft.total, status: "paid", paymentStatus: "paid", paidAt: new Date(), statusHistory: [{ status: "paid", message: "Order placed via Webhook." }], items: { create: orderItemsData } } });
    await prisma.draftOrder.delete({ where: { id: draft.id } });

    const sellerIds = [...new Set(orderItemsData.map((i) => i.sellerId))];
    for (const sId of sellerIds) {
      await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: sId, type: "listing_sold", title: "New Order (Paid)", message: `You sold items in order #${order.orderNumber}.`, link: `/seller/orders/${order.id}` } });
    }
  } else {
    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "paid", status: "paid", paidAt: new Date() } });
  }

  const existing = await prisma.payment.findFirst({ where: { gatewayPaymentIntentId: paymentIntent.id } });
  if (!existing) {
    const payment = await prisma.payment.create({ data: { buyerId: order.buyerId, amount: order.total, currency: "PKR", status: "succeeded", gateway: "stripe", gatewayPaymentIntentId: paymentIntent.id, platformFee, gatewayFee, sellerPayout, paidAt: new Date(), description: `Webhook payment for order #${order.orderNumber}`, orders: { connect: [{ id: order.id }] } } });
    await prisma.order.update({ where: { id: order.id }, data: { paymentId: payment.id } });
  }

  await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined,  userId: order.buyerId, type: "order_status_updated", title: "Order Paid!", message: `Payment for order #${order.orderNumber} confirmed.`, link: `/buyer/orders/${order.id}/track` } });
  // Payout is now held in escrow and handled upon delivery
  console.log(`[Webhook] Order ${order.orderNumber} confirmed.`);
}
