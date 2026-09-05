import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function findUser() {
    const query = "ayesha";
    console.log(`Searching for users with email containing "${query}"...`);
    const users = await prisma.user.findMany({
        where: {
            email: { contains: query, mode: 'insensitive' }
        },
        select: { email: true, name: true, role: true, isSuspended: true }
    });
    console.log(JSON.stringify(users, null, 2));
    process.exit();
}

findUser().catch(err => {
    console.error(err);
    process.exit(1);
});
