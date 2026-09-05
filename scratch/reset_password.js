import "dotenv/config";
import prisma from "../config/db.js";
import bcrypt from "bcryptjs";

async function main() {
  try {
    const hashedPassword = await bcrypt.hash("password123", 10);
    const user = await prisma.user.update({
      where: { email: "misha@gmail.com" },
      data: { password: hashedPassword }
    });
    console.log("Password updated for:", user.email);
  } catch (err) {
    console.error("Update Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
