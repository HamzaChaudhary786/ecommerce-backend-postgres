const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.user.updateMany({ data: { businessType: 'MANUFACTURER' } });
  
  const users = await prisma.user.findMany({ take: 3 });
  if (users.length > 0) {
    await prisma.user.update({
      where: { id: users[0].id },
      data: { businessType: 'WHOLESALER' }
    });
  }
  if (users.length > 1) {
    await prisma.user.update({
      where: { id: users[1].id },
      data: { businessType: 'SUPPLIER' }
    });
  }
  
  console.log('Done updating test users!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
