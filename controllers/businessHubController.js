import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess } from "../utils/helpers.js";

// ─── GET ALL HUBS ─────────────────────────────────────────────────────────────
export const getHubs = catchAsync(async (req, res, next) => {
  const { admin } = req.query;
  
  const query = {};
  // If not requested by admin dashboard, only return active hubs
  if (!admin || admin !== 'true') {
    query.where = { isActive: true };
  }

  const hubs = await prisma.businessHub.findMany({
    ...query,
    orderBy: { createdAt: 'desc' }
  });

  sendSuccess(res, 200, "Hubs fetched successfully", { hubs });
});

// ─── GET SINGLE HUB ───────────────────────────────────────────────────────────
export const getHub = catchAsync(async (req, res, next) => {
  const hub = await prisma.businessHub.findUnique({
    where: { id: req.params.id }
  });

  if (!hub) return next(new AppError("Hub not found", 404));
  sendSuccess(res, 200, "Hub fetched successfully", { hub });
});

// ─── CREATE HUB ───────────────────────────────────────────────────────────────
export const createHub = catchAsync(async (req, res, next) => {
  const { country, industry, tagline, description, image, isActive } = req.body;

  if (!country || !industry || !image) {
    return next(new AppError("Please provide all required fields", 400));
  }

  const hub = await prisma.businessHub.create({
    data: {
      country,
      industry,
      tagline: tagline || "",
      description: description || "",
      image,
      isActive: isActive !== undefined ? isActive : true
    }
  });

  sendSuccess(res, 201, "Business Hub created successfully", { hub });
});

// ─── UPDATE HUB ───────────────────────────────────────────────────────────────
export const updateHub = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { country, industry, tagline, description, image, isActive } = req.body;

  const existingHub = await prisma.businessHub.findUnique({ where: { id } });
  if (!existingHub) return next(new AppError("Hub not found", 404));

  const hub = await prisma.businessHub.update({
    where: { id },
    data: {
      country: country !== undefined ? country : existingHub.country,
      industry: industry !== undefined ? industry : existingHub.industry,
      tagline: tagline !== undefined ? tagline : existingHub.tagline,
      description: description !== undefined ? description : existingHub.description,
      image: image !== undefined ? image : existingHub.image,
      isActive: isActive !== undefined ? isActive : existingHub.isActive
    }
  });

  sendSuccess(res, 200, "Business Hub updated successfully", { hub });
});

// ─── DELETE HUB ───────────────────────────────────────────────────────────────
export const deleteHub = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const existingHub = await prisma.businessHub.findUnique({ where: { id } });
  if (!existingHub) return next(new AppError("Hub not found", 404));

  await prisma.businessHub.delete({
    where: { id }
  });

  sendSuccess(res, 200, "Business Hub deleted successfully", null);
});
