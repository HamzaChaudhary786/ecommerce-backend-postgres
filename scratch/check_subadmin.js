import prisma from "../config/db.js";

async function checkSubadmin() {
  const users = await prisma.user.findMany({
    where: {
      role: 'subadmin'
    }
  });
  console.log("Subadmins found:", JSON.stringify(users, null, 2));
  
  const allUsers = await prisma.user.findMany({
    take: 10,
    select: {
      email: true,
      role: true
    }
  });
  console.log("Sample users:", JSON.stringify(allUsers, null, 2));
}

checkSubadmin()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
