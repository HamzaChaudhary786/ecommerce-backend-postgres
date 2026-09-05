import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

async function main() {
  try {
    const users = await prisma.$queryRaw`SELECT email, role FROM "User" WHERE email = 'misha@gmail.com'`;
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
