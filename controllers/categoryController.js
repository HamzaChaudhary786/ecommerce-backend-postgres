import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess } from "../utils/helpers.js";

// ─── CREATE CATEGORY ──────────────────────────────────────────────────────────
export const createCategory = catchAsync(async (req, res, next) => {
  const { name, slug, description, image, icon, parent, attributes, meta, isFeatured, sortOrder } = req.body;

  let ancestors = [];
  let level = 0;

  if (parent) {
    const parentCat = await prisma.category.findUnique({ where: { id: parent } });
    if (!parentCat) return next(new AppError("Parent category not found.", 404));

    ancestors = [
      ...(parentCat.ancestors || []),
      { id: parentCat.id, name: parentCat.name, slug: parentCat.slug },
    ];
    level = parentCat.level + 1;
  }

  // Ensure slug uniqueness
  let finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  let uniqueSlug = finalSlug;
  let counter = 1;

  while (true) {
    const existing = await prisma.category.findUnique({ where: { slug: uniqueSlug } });
    if (!existing) break;
    uniqueSlug = `${finalSlug}-${counter}`;
    counter++;
  }

  const category = await prisma.category.create({
    data: {
      name,
      slug: uniqueSlug,
      description,
      image,
      icon,
      parentId: parent || null,
      ancestors,
      level,
      attributes: attributes || [],
      metaTitle: meta?.title,
      metaDesc: meta?.description,
      metaKeywords: meta?.keywords || [],
      isFeatured: isFeatured || false,
      sortOrder: sortOrder || 0,
    },
  });

  sendSuccess(res, 201, "Category created.", { data: { category } });
});

// ─── GET ALL CATEGORIES ────────────────────────────────────────────────────────
export const getAllCategories = catchAsync(async (req, res) => {
  try {
    const { tree, featured, active } = req.query;

    const where = {};
    if (active === "true") where.isActive = true;
    else if (active === "false") where.isActive = false;
    else if (active !== "all") where.isActive = true;
    if (featured === "true") where.isFeatured = true;

    if (tree === "true") {
      const allCategories = await prisma.category.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          listings: {
            where: { status: "active" },
            take: 1,
            select: { images: true },
            orderBy: { createdAt: "desc" }
          }
        }
      });

      const buildTree = (parentId, parentFallbackImage = null) =>
        allCategories
          .filter((c) => c.parentId === parentId)
          .map((c) => {
            const myFallback = c.listings?.length > 0 && c.listings[0].images?.length > 0 ? c.listings[0].images[0]?.url : null;
            const finalImage = c.image || myFallback || parentFallbackImage;
            return { 
              ...c, 
              image: finalImage,
              children: buildTree(c.id, finalImage) 
            };
          });

      const treeResult = buildTree(null);
      return sendSuccess(res, 200, "Category tree fetched.", { data: { categories: treeResult } });
    }

    if (req.query.all !== "true") where.parentId = null;

    const categories = await prisma.category.findMany({
      where,
      include: {
        parent: { select: { name: true, slug: true } },
        listings: {
          where: { status: "active" },
          take: 1,
          select: { images: true },
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    sendSuccess(res, 200, "Categories fetched.", { data: { categories } });
  } catch (err) {
    console.error("[getAllCategories] Error:", err?.message);
    sendSuccess(res, 200, "Categories fetched.", { data: { categories: [] } });
  }
});

// ─── GET SINGLE CATEGORY ──────────────────────────────────────────────────────
export const getCategory = catchAsync(async (req, res, next) => {
  const category = await prisma.category.findUnique({
    where: { id: req.params.id },
    include: { parent: { select: { name: true, slug: true } } },
  });
  if (!category) return next(new AppError("Category not found.", 404));

  const children = await prisma.category.findMany({
    where: { parentId: category.id, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  sendSuccess(res, 200, "Category fetched.", { data: { category, children } });
});

// ─── GET CATEGORY BY SLUG ─────────────────────────────────────────────────────
export const getCategoryBySlug = catchAsync(async (req, res, next) => {
  const category = await prisma.category.findUnique({ where: { slug: req.params.slug } });
  if (!category) return next(new AppError("Category not found.", 404));

  const children = await prisma.category.findMany({
    where: { parentId: category.id, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  sendSuccess(res, 200, "Category fetched.", { data: { category, children } });
});

// ─── GET CATEGORY BREADCRUMB ──────────────────────────────────────────────────
export const getCategoryBreadcrumb = catchAsync(async (req, res, next) => {
  const category = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!category) return next(new AppError("Category not found.", 404));

  const breadcrumb = [
    ...(category.ancestors || []),
    { id: category.id, name: category.name, slug: category.slug },
  ];

  sendSuccess(res, 200, "Breadcrumb fetched.", { data: { breadcrumb } });
});

// ─── UPDATE CATEGORY ──────────────────────────────────────────────────────────
export const updateCategory = catchAsync(async (req, res, next) => {
  const { parent, ancestors, level, ...rest } = req.body;

  // Map meta object to flat fields if provided
  if (rest.meta) {
    rest.metaTitle = rest.meta.title;
    rest.metaDesc = rest.meta.description;
    rest.metaKeywords = rest.meta.keywords || [];
    delete rest.meta;
  }

  const category = await prisma.category.update({
    where: { id: req.params.id },
    data: rest,
  }).catch(() => null);

  if (!category) return next(new AppError("Category not found.", 404));
  sendSuccess(res, 200, "Category updated.", { data: { category } });
});

// ─── DELETE CATEGORY ──────────────────────────────────────────────────────────
export const deleteCategory = catchAsync(async (req, res, next) => {
  const childCount = await prisma.category.count({ where: { parentId: req.params.id } });
  if (childCount > 0) {
    return next(new AppError(`Cannot delete: ${childCount} subcategories exist. Delete them first.`, 400));
  }

  try {
    await prisma.category.delete({ where: { id: req.params.id } });
  } catch {
    return next(new AppError("Category not found.", 404));
  }
  sendSuccess(res, 200, "Category deleted.");
});

// ─── TOGGLE ACTIVE STATUS ─────────────────────────────────────────────────────
export const toggleActive = catchAsync(async (req, res, next) => {
  const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Category not found.", 404));

  const category = await prisma.category.update({
    where: { id: req.params.id },
    data: { isActive: !existing.isActive },
  });

  sendSuccess(res, 200, `Category ${category.isActive ? "activated" : "deactivated"}.`, { data: { category } });
});

// ─── GET CATEGORY ATTRIBUTES ──────────────────────────────────────────────────
export const getCategoryAttributes = catchAsync(async (req, res, next) => {
  const category = await prisma.category.findUnique({
    where: { id: req.params.id },
    select: { attributes: true, name: true },
  });
  if (!category) return next(new AppError("Category not found.", 404));

  sendSuccess(res, 200, "Category attributes fetched.", {
    data: { categoryName: category.name, attributes: category.attributes },
  });
});