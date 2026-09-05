import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";

export const createCoupon = catchAsync(async (req, res, next) => {
  const existingCode = await prisma.coupon.findUnique({ where: { code: req.body.code } });
  if (existingCode) return next(new AppError("Coupon code already exists.", 400));

  const existingMinOrder = await prisma.coupon.findFirst({
    where: { 
      createdById: req.user.id, 
      minOrderAmount: req.body.minOrderAmount || 0 
    }
  });
  if (existingMinOrder) return next(new AppError("You already have a coupon with this minimum spend amount.", 400));

  const coupon = await prisma.coupon.create({ data: { ...req.body, createdById: req.user.id } });
  sendSuccess(res, 201, "Coupon created.", { data: { coupon } });
});

export const getAllCoupons = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.isActive !== undefined) where.isActive = req.query.isActive === "true";

  const [coupons, total] = await Promise.all([
    prisma.coupon.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.coupon.count({ where }),
  ]);
  sendSuccess(res, 200, "Coupons fetched.", { data: { coupons, total, page, pages: Math.ceil(total / limit) } });
});

export const getCoupon = catchAsync(async (req, res, next) => {
  const coupon = await prisma.coupon.findUnique({ where: { id: req.params.id } });
  if (!coupon) return next(new AppError("Coupon not found.", 404));
  sendSuccess(res, 200, "Coupon fetched.", { data: { coupon } });
});

export const validateCoupon = catchAsync(async (req, res, next) => {
  const { code, orderAmount } = req.body;
  const now = new Date();
  const coupon = await prisma.coupon.findFirst({
    where: { code: code?.toUpperCase(), isActive: true, OR: [{ startDate: { lte: now } }, { startDate: null }], AND: [{ OR: [{ endDate: { gte: now } }, { endDate: null }] }] },
  });
  if (!coupon) return next(new AppError("Invalid or expired coupon.", 400));
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) return next(new AppError("Coupon has reached its usage limit.", 400));
  if (coupon.minOrderAmount && orderAmount < coupon.minOrderAmount) return next(new AppError(`Minimum order of $${coupon.minOrderAmount} required.`, 400));

  let discount = 0;
  if (coupon.type === "percentage") { discount = (orderAmount * coupon.value) / 100; if (coupon.maxDiscountAmount) discount = Math.min(discount, coupon.maxDiscountAmount); }
  else if (coupon.type === "fixed_amount") { discount = Math.min(coupon.value, orderAmount); }

  sendSuccess(res, 200, "Coupon valid.", { data: { code: coupon.code, type: coupon.type, value: coupon.value, discount: parseFloat(discount.toFixed(2)), description: coupon.description } });
});

export const updateCoupon = catchAsync(async (req, res, next) => {
  const { usageCount, usageHistory, createdById, ...data } = req.body;
  const coupon = await prisma.coupon.update({ where: { id: req.params.id }, data }).catch(() => null);
  if (!coupon) return next(new AppError("Coupon not found.", 404));
  sendSuccess(res, 200, "Coupon updated.", { data: { coupon } });
});

export const deleteCoupon = catchAsync(async (req, res, next) => {
  try { await prisma.coupon.delete({ where: { id: req.params.id } }); }
  catch { return next(new AppError("Coupon not found.", 404)); }
  sendSuccess(res, 200, "Coupon deleted.");
});

export const toggleCoupon = catchAsync(async (req, res, next) => {
  const existing = await prisma.coupon.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Coupon not found.", 404));
  const coupon = await prisma.coupon.update({ where: { id: req.params.id }, data: { isActive: !existing.isActive } });
  sendSuccess(res, 200, `Coupon ${coupon.isActive ? "activated" : "deactivated"}.`, { data: { coupon } });
});

export const getSellerCoupons = catchAsync(async (req, res) => {
  const now = new Date();
  const coupons = await prisma.coupon.findMany({
    where: { applicableSellers: { has: req.params.sellerId }, isActive: true, OR: [{ startDate: { lte: now } }, { startDate: null }], AND: [{ OR: [{ endDate: { gte: now } }, { endDate: null }] }] },
    orderBy: { minOrderAmount: "asc" },
  });
  sendSuccess(res, 200, "Seller vouchers fetched.", { data: { coupons } });
});

export const getMyCoupons = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const [coupons, total] = await Promise.all([
    prisma.coupon.findMany({ where: { createdById: req.user.id }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.coupon.count({ where: { createdById: req.user.id } }),
  ]);
  sendSuccess(res, 200, "My coupons fetched.", { data: { coupons, total, page, pages: Math.ceil(total / limit) } });
});

export const createSellerCoupon = catchAsync(async (req, res, next) => {
  const existingCode = await prisma.coupon.findUnique({ where: { code: req.body.code } });
  if (existingCode) return next(new AppError("Voucher code already exists.", 400));

  const existingMinOrder = await prisma.coupon.findFirst({
    where: { 
      createdById: req.user.id, 
      minOrderAmount: req.body.minOrderAmount || 0 
    }
  });
  if (existingMinOrder) return next(new AppError("You already have a voucher with this minimum spend amount.", 400));

  const coupon = await prisma.coupon.create({ data: { ...req.body, createdById: req.user.id, applicableSellers: [req.user.id] } });
  sendSuccess(res, 201, "Voucher created.", { data: { coupon } });
});

export const updateSellerCoupon = catchAsync(async (req, res, next) => {
  const existing = await prisma.coupon.findFirst({ where: { id: req.params.id, createdById: req.user.id } });
  if (!existing) return next(new AppError("Voucher not found or access denied.", 404));
  const { usageCount, usageHistory, createdById, applicableSellers, ...data } = req.body;
  const coupon = await prisma.coupon.update({ where: { id: req.params.id }, data });
  sendSuccess(res, 200, "Voucher updated.", { data: { coupon } });
});

export const deleteSellerCoupon = catchAsync(async (req, res, next) => {
  const existing = await prisma.coupon.findFirst({ where: { id: req.params.id, createdById: req.user.id } });
  if (!existing) return next(new AppError("Voucher not found or access denied.", 404));
  await prisma.coupon.delete({ where: { id: req.params.id } });
  sendSuccess(res, 200, "Voucher deleted.");
});