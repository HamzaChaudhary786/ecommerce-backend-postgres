import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkBuyers() {
    console.log("Checking buyer users...");
    const buyers = await prisma.user.findMany({
        where: {
            role: "buyer",
            isSuspended: false,
            email: { not: "" }
        },
        select: { email: true, name: true, role: true }
    });
    console.log(`Found ${buyers.length} buyers:`);
    console.log(JSON.stringify(buyers, null, 2));

    process.exit();
}

checkBuyers().catch(err => {
    console.error(err);
    process.exit(1);
});
