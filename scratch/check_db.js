
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const users = await prisma.user.findMany({ take: 1 });
    console.log('✅ User table exists and is accessible.');
  } catch (error) {
    console.error('❌ Error accessing User table:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
