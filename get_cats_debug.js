import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
    try {
        const cats = await prisma.category.findMany({
            select: { name: true, id: true, parentId: true }
        });
        console.log('---START_CATS---');
        cats.forEach(c => console.log(`${c.id}|${c.name}|${c.parentId}`));
        console.log('---END_CATS---');
    } catch (e) {
        console.error('ERROR:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}
run();
