import prisma from '../config/db.js';

async function main() {
  try {
    const listing = await prisma.listing.findFirst({
      where: { title: { contains: 'iPhone 11 Case' } }
    });
    console.log(JSON.stringify(listing, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
