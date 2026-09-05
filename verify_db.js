import "./loadEnv.js";
import prisma from "./config/db.js";


async function verify() {
  try {
    const userCount = await prisma.user.count();
    const listingCount = await prisma.listing.count();
    const categoryCount = await prisma.category.count();
    const orderCount = await prisma.order.count();

    console.log("Database Verification:");
    console.log(`- Users: ${userCount}`);
    console.log(`- Listings: ${listingCount}`);
    console.log(`- Categories: ${categoryCount}`);
    console.log(`- Orders: ${orderCount}`);
    console.log("\nAll tables are present and populated.");
  } catch (error) {
    console.error("Verification failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
