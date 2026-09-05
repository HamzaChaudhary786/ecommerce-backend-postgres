import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
    const user = await prisma.user.findFirst({
        where: { email: 'ayeshakhadam2@gmail.com' },
        select: {
            email: true,
            role: true,
            isVerified: true,
            isSuspended: true,
            googleId: true
        }
    });
    console.log(JSON.stringify(user, null, 2));
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
