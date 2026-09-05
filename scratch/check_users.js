import "dotenv/config";
import prisma from "../config/db.js";

async function main() {
  try {
    const users = await prisma.user.findMany({
      select: {
        email: true,
        role: true,
        isSuspended: true
      }
    });
    console.log("USERS_START");
    console.log(JSON.stringify(users, null, 2));
    console.log("USERS_END");
  } catch (err) {
    console.error("Query Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
