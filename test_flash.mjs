import prisma from './config/db.js';
try {
  const now = new Date();
  const r = await prisma.flashSale.findMany({
    where: {
      status: { in: ['approved','active'] },
      flashSaleStock: { gt: 0 },
      OR: [{ startTime: { lte: now } }, { startTime: null }],
      AND: [{ OR: [{ endTime: { gte: now } }, { endTime: null }] }],
    },
    include: {
      listing: {
        include: {
          category: { select: { name: true, icon: true } },
          seller: {
            select: {
              createdAt: true, username: true, name: true, avatar: true,
              store: { select: { createdAt: true, storeSlug: true, storeName: true, logo: true } }
            }
          }
        }
      }
    },
    orderBy: { discountPercentage: 'desc' },
  });
  console.log('OK, count:', r.length);
} catch(e) {
  console.error('ERROR code:', e.code);
  console.error('ERROR meta:', JSON.stringify(e.meta));
  console.error('ERROR msg:', e.message?.slice(0,1000));
}
await prisma.$disconnect();
