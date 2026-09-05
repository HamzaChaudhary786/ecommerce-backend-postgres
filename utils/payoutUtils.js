import stripeLib from "stripe";
import prisma from "../config/db.js";

const getStripe = () => stripeLib(process.env.STRIPE_MODE === "live" ? process.env.STRIPE_LIVE_SECRET_KEY : process.env.STRIPE_TEST_SECRET_KEY);

export const processSellerPayouts = async (orderId) => {
  const stripe = getStripe();

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) { console.error(`[Payout Utility] Order ${orderId} not found.`); return; }
  if (order.payoutStatus === "paid") { console.log(`[Payout Utility] Payouts for Order #${order.orderNumber} already processed.`); return; }

  await prisma.order.update({ where: { id: orderId }, data: { payoutStatus: "processing" } });
  console.log(`[Payout Utility] Starting payouts for Order #${order.orderNumber}...`);

  const sellerGroups = order.items.reduce((acc, item) => {
    if (!acc[item.sellerId]) acc[item.sellerId] = { total: 0, items: [] };
    acc[item.sellerId].total += item.price * item.quantity;
    acc[item.sellerId].items.push(item);
    return acc;
  }, {});

  const platformFeeRate = 0.1275, gatewayFeeRate = 0.029, gatewayFixed = 0.30;
  let allSuccessful = true;

  for (const sellerId in sellerGroups) {
    try {
      const isTestMode = process.env.STRIPE_MODE === "test";
      const store = await prisma.sellerStore.findUnique({ where: { sellerId } });
      console.log(`[Payout Utility] Store: ${store?.storeName}, Account: ${store?.stripeConnectedAccountId}, Complete: ${store?.stripeOnboardingComplete}`);

      if (store?.stripeConnectedAccountId && (store.stripeOnboardingComplete || isTestMode)) {
        const amount = sellerGroups[sellerId].total;
        const payout = parseFloat((amount * (1 - platformFeeRate) - (amount * gatewayFeeRate + gatewayFixed)).toFixed(2));
        console.log(`[Payout Utility] Subtotal: ${amount}, Payout: ${payout}`);

        if (payout > 0) {
          const payment = await prisma.payment.findFirst({ where: { orders: { some: { id: orderId } }, gateway: "stripe" } });
          let transferCurrency = "pkr", transferAmount = Math.round(payout * 100), source_transaction;

          if (payment?.gatewayPaymentIntentId) {
            try {
              const pi = await stripe.paymentIntents.retrieve(payment.gatewayPaymentIntentId, { expand: ["latest_charge.balance_transaction"] });
              const charge = pi.latest_charge;
              const bt = charge?.balance_transaction;
              if (charge) {
                source_transaction = charge.id;
                if (bt && bt.currency !== pi.currency) {
                  transferCurrency = bt.currency;
                  transferAmount = bt.exchange_rate ? Math.round(payout * bt.exchange_rate * 100) : Math.round(payout * 100 * (bt.amount / charge.amount));
                } else { transferCurrency = pi.currency; }
              }
            } catch (piErr) { console.error(`[Payout Utility] PI Retrieval Error: ${piErr.message}`); }
          }

          const transferData = { amount: transferAmount, currency: transferCurrency, destination: store.stripeConnectedAccountId, description: `Payout for Order #${order.orderNumber}`, metadata: { orderId: order.id, sellerId } };
          if (source_transaction) transferData.source_transaction = source_transaction;
          console.log(`[Payout Utility] Transfer:`, JSON.stringify(transferData));
          const transfer = await stripe.transfers.create(transferData);
          console.log(`[Payout Utility] SUCCESS: ${transferAmount / 100} ${transferCurrency.toUpperCase()} to ${sellerId} (${transfer.id})`);
        } else { console.log(`[Payout Utility] Payout too low (${payout}). Skipping.`); }
      } else { console.warn(`[Payout Utility] Skipping seller ${sellerId}. Account missing.`); allSuccessful = false; }
    } catch (error) { console.error(`[Payout Utility] TRANSFER FAILED for ${sellerId}:`, error.message); allSuccessful = false; }
  }

  await prisma.order.update({ where: { id: orderId }, data: { payoutStatus: allSuccessful ? "paid" : "failed" } });
  console.log(`[Payout Utility] Done for Order #${order.orderNumber}. Status: ${allSuccessful ? "paid" : "failed"}`);
};
