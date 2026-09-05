import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    try {
        const item = await prisma.orderItem.findUnique({
            where: { id: '181b6f4b-6eb3-40e6-9503-671087352c68' }
        });
        console.log(JSON.stringify(item, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
