import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  try {
    const items = await prisma.orderItem.findMany({
      where: {
        returnStatus: { not: 'none' }
      },
      select: {
        id: true,
        returnStatus: true,
        itemStatus: true,
        returnReceivedBySeller: true,
        title: true
      }
    });
    console.log(items);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
