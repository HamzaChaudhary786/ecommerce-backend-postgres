const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    select: { id: true, orderNumber: true, orderSource: true, status: true },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log(JSON.stringify(orders, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
