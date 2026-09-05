import stripeLib from "stripe";
import prisma from "../config/db.js";
import { AppError } from "./helpers.js";

const getStripe = () => stripeLib(process.env.STRIPE_MODE === "live" ? process.env.STRIPE_LIVE_SECRET_KEY : process.env.STRIPE_TEST_SECRET_KEY);

/**
 * Core refund logic that can be used by controllers
 * @param {Object} payment - The payment object
 * @param {Number} amount - Amount to refund
 * @param {String} reason - Reason for refund
 * @param {String} userId - ID of the user initiating refund
 * @param {Object} metadata - Optional metadata (orderId, itemId, etc)
 */
export const processRefundInternal = async (payment, amount, reason, userId, metadata = {}) => {
  if (!amount || amount <= 0) throw new AppError("Refund amount is required.", 400);
  
  const maxRefundable = parseFloat((payment.amount - payment.totalRefunded).toFixed(2));
  if (amount > maxRefundable) throw new AppError(`Maximum refundable amount is PKR ${maxRefundable.toFixed(2)}`, 400);

  let gatewayRefundId = `re_mock_${Date.now()}`;
  
  // Real Stripe Refund
  if (payment.gateway === "stripe" && payment.gatewayPaymentIntentId) {
    const stripe = getStripe();
    try {
      const refund = await stripe.refunds.create({
        payment_intent: payment.gatewayPaymentIntentId,
        amount: Math.round(amount * 100), // convert to cents for Stripe
        reason: "requested_by_customer",
        metadata: { 
          paymentId: payment.id, 
          reason: reason || "Admin refund",
          ...metadata
        }
      });
      gatewayRefundId = refund.id;
    } catch (err) {
      throw new AppError(`Gateway Refund Failed: ${err.message}`, 400);
    }
  }

  const newRefunds = [...(payment.refunds || []), { 
    amount, 
    reason: reason || "Admin refund", 
    gatewayRefundId, 
    initiatedBy: userId, 
    createdAt: new Date(),
    ...metadata
  }];
  
  const newTotalRefunded = parseFloat((payment.totalRefunded + amount).toFixed(2));
  const newStatus = newTotalRefunded >= payment.amount ? "refunded" : "partially_refunded";

  const updatedPayment = await prisma.payment.update({ 
    where: { id: payment.id }, 
    data: { 
      refunds: newRefunds, 
      totalRefunded: newTotalRefunded, 
      status: newStatus 
    } 
  });

  return { updatedPayment, newStatus, gatewayRefundId };
};
