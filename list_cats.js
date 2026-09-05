import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const categories = await prisma.category.findMany({
        where: { parentId: null },
        select: { id: true, name: true }
    });
    console.log(JSON.stringify(categories));
}
main().finally(() => prisma.$disconnect());
