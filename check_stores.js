import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const stores = await prisma.sellerStore.findMany({ select: { name: true, isVerified: true, id: true } });
  console.log('Stores:', stores);
  await prisma.$disconnect();
}
check();
