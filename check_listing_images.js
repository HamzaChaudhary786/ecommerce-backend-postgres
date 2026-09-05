import "./loadEnv.js";
import prisma from "./config/db.js";

async function main() {
  const listings = await prisma.listing.findMany({
    where: { status: "active" },
    select: {
      id: true,
      title: true,
      images: true,
      category: { select: { name: true } }
    }
  });

  console.log(`Checking ${listings.length} listings:`);
  listings.forEach((l) => {
    console.log(`\nTitle: "${l.title}" | Category: "${l.category?.name}"`);
    if (l.images && Array.isArray(l.images)) {
      l.images.forEach((img) => {
        console.log(`  - Image URL: ${img.url}`);
      });
    } else {
      console.log(`  - No images`);
    }
  });

  process.exit(0);
}

main();
