import express from 'express';
import prisma from '../config/db.js';
const router = express.Router();

router.get('/promotions', async (req, res) => {
  try {
    // Fetch real active "deal of the day" listings from DB
    const listings = await prisma.listing.findMany({
      where: { status: 'active', isDealOfTheDay: true, dealStatus: 'approved', isFeatured: true },
      include: {
        seller: {
          select: {
            store: { select: { storeSlug: true, storeName: true } }
          }
        },
        flashSales: {
          where: {
            status: { in: ['approved', 'active'] },
            OR: [
              { startTime: null },
              { startTime: { lte: new Date() } }
            ],
            AND: [
              { OR: [{ endTime: null }, { endTime: { gte: new Date() } }] }
            ]
          },
          take: 1
        }
      },
      take: 5,
      orderBy: { createdAt: 'desc' }
    });

    let promotions = listings.map((listing, index) => {
      const flash = listing.flashSales?.[0];
      const originalPrice = listing.price;
      const salePrice = flash ? Math.round(originalPrice * (1 - flash.discountPercentage / 100)) : originalPrice;
      const discountPct = flash ? Math.round(flash.discountPercentage) : (listing.dealDiscountPercent || 0);
      const endTime = flash?.endTime
        ? flash.endTime.toISOString()
        : new Date(Date.now() + (6 + index * 2) * 60 * 60 * 1000).toISOString();

      return {
        id: listing.id,
        title: listing.title,
        subtitle: listing.description?.slice(0, 60) || 'Limited time offer',
        price: salePrice.toLocaleString('en-PK'),
        originalPrice: originalPrice.toLocaleString('en-PK'),
        discount: discountPct > 0 ? `-${discountPct}%` : null,
        claimed: listing.quantity > 0 ? Math.max(0, listing.quantity - (listing.remainingQuantity ?? listing.quantity)) : 0,
        total: listing.quantity || 100,
        endTime,
        buttonText: 'Claim this deal',
        buttonLink: `/listings/${listing.id}`,
        badge: '⚡ FLASH DEAL',
        images: listing.images?.slice(0, 3) || [],
        image: listing.images?.[0] || null // Keep for backwards compatibility if needed elsewhere
      };
    });

    res.json({ success: true, data: promotions });
  } catch (err) {
    console.error('[promotions error]', err.message);
    res.json({ success: true, data: [] });
  }
});

// GET /api/home/featured-suppliers
router.get('/featured-suppliers', async (req, res) => {
  try {
    const stores = await prisma.sellerStore.findMany({
      where: { isVerified: true, status: 'approved' },
      include: {
        seller: {
          select: {
            name: true,
            businessType: true,
            positiveFeedbackPercent: true,
            createdAt: true,
            addresses: { select: { city: true, country: true }, take: 1 },
          }
        }
      },
      take: 3,
      orderBy: { totalSales: 'desc' }
    });

    const suppliers = stores.map(store => {
      const seller = store.seller;
      const address = seller?.addresses?.[0];
      const createdDate = store.createdAt || seller?.createdAt;
      let yearsOnPlatform = "1 Yr";
      if (createdDate) {
        const diffTime = Math.abs(new Date() - new Date(createdDate));
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays < 30) {
          yearsOnPlatform = `${diffDays || 1} Day${diffDays > 1 ? 's' : ''}`;
        } else {
          const diffMonths = Math.floor(diffDays / 30);
          if (diffMonths < 12) {
            yearsOnPlatform = `${diffMonths} Month${diffMonths > 1 ? 's' : ''}`;
          } else {
            const diffYears = Math.floor(diffMonths / 12);
            yearsOnPlatform = `${diffYears} Yr${diffYears > 1 ? 's' : ''}`;
          }
        }
      }

      return {
        id: store.id,
        supplierName: store.storeName,
        storeSlug: store.storeSlug,
        category: seller?.businessType || 'Supplier',
        location: [address?.city, address?.country].filter(Boolean).join(', ') || 'Pakistan',
        responseRate: store.onTimeRate ? Math.round(store.onTimeRate) : 95,
        yearsOnPlatform,
        rating: seller?.positiveFeedbackPercent ? (seller.positiveFeedbackPercent / 20).toFixed(1) : '4.8',
        image: store.banner || store.logo || null,
        profileLink: `/stores/${store.storeSlug}`,
      };
    });

    res.json({ success: true, data: suppliers });
  } catch (err) {
    console.error('[featured-suppliers error]', err.message);
    res.json({ success: true, data: [] });
  }
});

export default router;

