const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.listing.findMany({select: {title: true, shippingFrom: true}}).then(listings => console.log(listings)).finally(() => prisma.$disconnect());
