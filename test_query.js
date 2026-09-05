import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const items = await prisma.orderItem.findMany({
    where: { title: { contains: 'Organic Coconut Hair Oil' } },
    select: { id: true, itemStatus: true, returnStatus: true, returnReason: true, sellerId: true, returnRequestedAt: true, order: { select: { buyerId: true } } }
  });
  console.log(JSON.stringify(items, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
