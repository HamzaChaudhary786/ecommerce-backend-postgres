const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const items = await prisma.orderItem.findMany({
    where: {
      returnStatus: { not: 'none' }
    },
    select: {
      id: true,
      orderId: true,
      returnStatus: true,
      itemStatus: true,
      returnReceivedBySeller: true,
      title: true
    }
  });
  console.log(JSON.stringify(items, null, 2));
}

check();
