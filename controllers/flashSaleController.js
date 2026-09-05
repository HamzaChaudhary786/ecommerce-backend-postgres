import prisma from "../config/db.js";
import { AppError } from "../utils/helpers.js";

// POST /api/flash-sales/request
export const requestFlashSale = async (req, res, next) => {
  try {
    const { listingIds, discountPercentage, flashSaleStock, startTime, endTime } = req.body;
    const ids = Array.isArray(listingIds) ? listingIds : [req.body.listingId].filter(Boolean);
    if (ids.length === 0) return next(new AppError("No listings provided", 400));

    const batchId = `BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const flashSales = [];

    for (const listingId of ids) {
      const listing = await prisma.listing.findUnique({ where: { id: listingId } });
      if (!listing || listing.sellerId !== req.user.id) continue;

      const existing = await prisma.flashSale.findFirst({ where: { listingId, status: { in: ["pending", "approved", "active"] } } });
      if (existing) continue;

      const stock = Math.min(flashSaleStock || 0, listing.quantity);
      const flashSalePrice = listing.price - (listing.price * (discountPercentage / 100));

      const sale = await prisma.flashSale.create({
        data: {
          listingId, sellerId: req.user.id, discountPercentage, flashSalePrice,
          flashSaleStock: stock, startTime: startTime ? new Date(startTime) : null,
          endTime: endTime ? new Date(endTime) : null, originalPrice: listing.price,
          originalListingStatus: listing.status, status: "pending",
          batchId: ids.length > 1 ? batchId : null,
        },
      });
      flashSales.push(sale);
    }
    res.status(201).json({ status: "success", results: flashSales.length, data: { flashSales } });
  } catch (err) { next(err); }
};

// PATCH /api/flash-sales/review or /:id/review
export const reviewFlashSale = async (req, res, next) => {
  try {
    const { status, startTime, endTime, adminComment, batchId, ids } = req.body;

    if (Array.isArray(ids) && ids.length > 0) {
      await prisma.flashSale.updateMany({
        where: { id: { in: ids }, status: "pending" },
        data: { status, adminComment, ...(startTime && { startTime: new Date(startTime) }), ...(endTime && { endTime: new Date(endTime) }) },
      });
      return res.status(200).json({ status: "success", message: `Updated ${ids.length} items.` });
    }

    if (batchId) {
      const result = await prisma.flashSale.updateMany({
        where: { batchId, status: "pending" },
        data: { status, adminComment, ...(startTime && { startTime: new Date(startTime) }), ...(endTime && { endTime: new Date(endTime) }) },
      });
      return res.status(200).json({ status: "success", message: `Updated ${result.count} items in batch.` });
    }

    const flashSale = await prisma.flashSale.update({
      where: { id: req.params.id },
      data: { status, adminComment, ...(startTime && { startTime: new Date(startTime) }), ...(endTime && { endTime: new Date(endTime) }) },
    }).catch(() => null);
    if (!flashSale) return next(new AppError("Flash sale not found", 404));

    res.status(200).json({ status: "success", data: { flashSale } });
  } catch (err) { next(err); }
};

// GET /api/flash-sales
export const getFlashSales = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.user?.role === "seller") where.sellerId = req.user.id;

    const flashSales = await prisma.flashSale.findMany({
      where,
      include: { listing: { include: { category: { select: { name: true, icon: true } } } }, seller: { select: { name: true, avatar: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ status: "success", results: flashSales.length, data: { flashSales } });
  } catch (err) { next(err); }
};

// GET /api/flash-sales/active
export const getActiveFlashSales = async (req, res, next) => {
  try {
    const now = new Date();
    const flashSales = await prisma.flashSale.findMany({
      where: {
        status: { in: ["approved", "active"] }, flashSaleStock: { gt: 0 },
        OR: [{ startTime: { lte: now } }, { startTime: null }],
        AND: [{ OR: [{ endTime: { gte: now } }, { endTime: null }] }],
      },
      include: { 
        listing: { include: { category: { select: { name: true, icon: true } }, seller: { select: { createdAt: true, username: true, name: true, avatar: true, store: { select: { createdAt: true, storeSlug: true, storeName: true, logo: true } } } } } } 
      },
      orderBy: { discountPercentage: "desc" },
    });
    res.status(200).json({ status: "success", results: flashSales.length, data: { flashSales } });
  } catch (err) {
    console.error("[getActiveFlashSales] Error:", err?.message);
    res.status(200).json({ status: "success", results: 0, data: { flashSales: [] } });
  }
};

// DELETE /api/flash-sales/:id
export const deleteFlashSale = async (req, res, next) => {
  try {
    const flashSale = await prisma.flashSale.findFirst({ where: { id: req.params.id, sellerId: req.user.id } });
    if (!flashSale) return next(new AppError("Flash sale not found", 404));
    await prisma.flashSale.delete({ where: { id: req.params.id } });
    res.status(204).json({ status: "success", data: null });
  } catch (err) { next(err); }
};

// DELETE /api/flash-sales/batch
export const deleteBatchFlashSales = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return next(new AppError("No IDs provided", 400));
    await prisma.flashSale.deleteMany({ where: { id: { in: ids }, sellerId: req.user.id } });
    res.status(204).json({ status: "success", data: null });
  } catch (err) { next(err); }
};
