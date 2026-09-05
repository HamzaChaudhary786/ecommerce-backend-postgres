import "../loadEnv.js";
import prisma from "../config/db.js";
import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";
const PASSWORD_HASH = await bcrypt.hash("password123", 10);

const seedData = async () => {
  try {
    console.log("Cleaning database...");
    await prisma.notification.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversationParticipant.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.dispute.deleteMany();
    await prisma.feedback.deleteMany();
    await prisma.review.deleteMany();
    await prisma.bid.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.offer.deleteMany();
    await prisma.flashSale.deleteMany();
    await prisma.listing.deleteMany();
    await prisma.sellerStore.deleteMany();
    await prisma.category.deleteMany();
    await prisma.address.deleteMany();
    await prisma.user.deleteMany();

    console.log("Seeding categories...");
    const rootCategories = ["Electronics", "Fashion", "Home & Garden", "Collectibles", "Motors", "Sports", "Toys", "Health", "Business", "Media"];
    const categories = [];
    for (const name of rootCategories) {
      const cat = await prisma.category.create({
        data: {
          name,
          slug: name.toLowerCase().replace(/ /g, "-") + "-" + faker.string.alphanumeric(6),
          description: faker.commerce.productDescription(),
          level: 0,
        }
      });
      categories.push(cat);
    }

    console.log("Seeding users...");
    const users = [];
    for (let i = 0; i < 20; i++) {
      const role = i === 0 ? "admin" : (i < 8 ? "seller" : "buyer");
      const user = await prisma.user.create({
        data: {
          firstName: faker.person.firstName(),
          lastName: faker.person.lastName(),
          username: faker.internet.username() + i,
          email: faker.internet.email(),
          password: PASSWORD_HASH,
          role: role,
          isVerified: true,
          registeredSeller: role === "seller",
          addresses: {
            create: [{
              fullName: faker.person.fullName(),
              phone: faker.phone.number(),
              street: faker.location.streetAddress(),
              city: faker.location.city(),
              state: faker.location.state(),
              postalCode: faker.location.zipCode(),
              country: "US",
              isDefault: true
            }]
          }
        }
      });
      users.push(user);
    }

    const sellers = users.filter(u => u.role === "seller");
    const buyers = users.filter(u => u.role === "buyer");

    console.log("Seeding seller stores...");
    for (const seller of sellers) {
      await prisma.sellerStore.create({
        data: {
          sellerId: seller.id,
          storeName: faker.company.name(),
          storeSlug: faker.helpers.slugify(faker.company.name()).toLowerCase() + "-" + faker.string.alphanumeric(4),
          description: faker.company.catchPhrase(),
          status: "approved",
          isVerified: true
        }
      });
    }

    console.log("Seeding listings...");
    const listings = [];
    for (let i = 0; i < 30; i++) {
      const seller = faker.helpers.arrayElement(sellers);
      const category = faker.helpers.arrayElement(categories);
      const type = faker.helpers.arrayElement(["fixed_price", "auction", "buy_it_now_auction"]);
      const price = faker.number.float({ min: 10, max: 1000, fractionDigits: 2 });

      const listing = await prisma.listing.create({
        data: {
          title: faker.commerce.productName(),
          description: faker.commerce.productDescription(),
          sellerId: seller.id,
          categoryId: category.id,
          listingType: type,
          status: "active",
          price: type !== "auction" ? price : undefined,
          startingBid: type !== "fixed_price" ? price * 0.1 : undefined,
          currentBid: type !== "fixed_price" ? price * 0.1 : undefined,
          buyItNowPrice: type === "buy_it_now_auction" ? price * 1.5 : undefined,
          condition: "new",
          images: [{ url: `https://picsum.photos/400/400?random=${i}`, isPrimary: true }],
          quantity: faker.number.int({ min: 1, max: 50 }),
          auctionEndTime: type !== "fixed_price" ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : undefined,
          shipping: { type: "flat_rate", cost: 5.99 }
        }
      });
      listings.push(listing);
    }

    console.log("Seeding orders...");
    for (let i = 0; i < 15; i++) {
      const buyer = faker.helpers.arrayElement(buyers);
      const listing = faker.helpers.arrayElement(listings);
      const amount = listing.price || listing.currentBid || 50;

      await prisma.order.create({
        data: {
          orderNumber: `ORD-${faker.string.alphanumeric(8).toUpperCase()}`,
          buyerId: buyer.id,
          status: "delivered",
          paymentStatus: "paid",
          subtotal: amount,
          shippingTotal: 5.99,
          total: amount + 5.99,
          items: {
            create: [{
              listingId: listing.id,
              sellerId: listing.sellerId,
              title: listing.title,
              price: amount,
              quantity: 1,
              image: listing.images?.[0]?.url || ""
            }]
          }
        }
      });
    }

    console.log("✅ Seed complete!");
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
};

seedData();
