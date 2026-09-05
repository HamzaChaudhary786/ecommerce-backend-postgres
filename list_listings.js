import "./loadEnv.js";
import prisma from "./config/db.js";

async function main() {
  const listings = await prisma.listing.findMany({
    where: { status: "active" },
    select: {
      id: true,
      title: true,
      brand: true,
      tags: true,
      category: { select: { name: true } }
    },
    take: 30
  });

  console.log(`Found ${listings.length} active listings:`);
  listings.forEach((l, i) => {
    console.log(`${i+1}. Title: "${l.title}" | Brand: "${l.brand}" | Category: "${l.category?.name}" | Tags: [${l.tags?.join(", ")}]`);
  });

  process.exit(0);
}

main();
