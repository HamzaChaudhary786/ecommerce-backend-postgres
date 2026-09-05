import prisma from './config/db.js';

async function findUser() {
    try {
        const query = "ayesha";
        console.log(`Searching for users with email containing "${query}"...`);
        const users = await prisma.user.findMany({
            where: {
                email: { contains: query, mode: 'insensitive' }
            },
            select: { email: true, name: true, role: true, isSuspended: true }
        });
        console.log("RESULT_START");
        console.log(JSON.stringify(users, null, 2));
        console.log("RESULT_END");
    } catch (err) {
        console.error("DB_ERROR:", err.message);
    } finally {
        await prisma.$disconnect();
        process.exit();
    }
}

findUser();
