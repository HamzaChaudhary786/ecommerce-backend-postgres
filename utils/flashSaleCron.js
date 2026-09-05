import cron from "node-cron";
import prisma from "../config/db.js";

cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();

    // End sales that have expired or run out of stock
    const endedSales = await prisma.flashSale.findMany({ where: { status: { in: ["approved", "active"] }, OR: [{ endTime: { lte: now } }, { flashSaleStock: { lte: 0 } }] } });
    for (const sale of endedSales) {
      await prisma.flashSale.update({ where: { id: sale.id }, data: { status: "ended" } });
      console.log(`Flash sale for ${sale.listingId} has ended.`);
    }

    // Activate approved sales whose startTime has passed
    await prisma.flashSale.updateMany({ where: { status: "approved", startTime: { lte: now }, endTime: { gt: now }, flashSaleStock: { gt: 0 } }, data: { status: "active" } });

  } catch (err) { console.error("Flash Sale Cron Error:", err); }
});
