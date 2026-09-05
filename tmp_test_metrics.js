
import "./loadEnv.js";
import prisma from "./config/db.js";


async function testMetrics() {
    try {
        console.log("Starting metrics calculation test...");
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const [totalUsers, totalStores, activeListings] = await Promise.all([
            prisma.user.count(),
            prisma.sellerStore.count({ where: { status: "approved" } }),
            prisma.listing.count({ where: { status: "active" } }),
        ]);
        console.log("Counts:", { totalUsers, totalStores, activeListings });

        // Revenue from paid orders
        const payments = await prisma.payment.findMany({ where: { status: "succeeded" }, select: { amount: true } });
        const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);
        console.log("Total Revenue:", totalRevenue);

        // Seller registrations per month
        const recentStores = await prisma.sellerStore.findMany({ where: { createdAt: { gte: sixMonthsAgo } }, select: { createdAt: true } });
        const monthMap = {};
        recentStores.forEach((s) => { const m = s.createdAt.toISOString().slice(0, 7); monthMap[m] = (monthMap[m] || 0) + 1; });
        const sellerRegistrations = Object.entries(monthMap).sort().map(([month, count]) => ({ month, count }));
        console.log("Seller Registrations:", sellerRegistrations);

        // Top 10 sellers by listing count
        console.log("Fetching top sellers...");
        const topSellers = await prisma.listing.groupBy({ by: ["sellerId"], _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 10 });
        console.log("Top Sellers Grouped:", topSellers);

        const productsPerSeller = await Promise.all(topSellers.map(async (s) => {
            console.log(`Type of count for ${s.sellerId}:`, typeof s._count.id);
            const store = await prisma.sellerStore.findUnique({ where: { sellerId: s.sellerId }, select: { storeName: true } });
            return { name: store?.storeName || s.sellerId, count: s._count.id };
        }));
        console.log("Products Per Seller:", productsPerSeller);

        console.log("Test finished successfully!");
    } catch (err) {
        console.error("ERROR during metrics test:");
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

testMetrics();
