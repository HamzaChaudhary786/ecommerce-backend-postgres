import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess, paginate } from "../utils/helpers.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import https from "https";

// Helper: enrich listings with active flash sale info
const enrichListingsWithFlash = async (listings) => {
  if (!listings || listings.length === 0) return [];
  const now = new Date();
  const listingIds = listings.map((l) => l.id);

  const activeFlashSales = await prisma.flashSale.findMany({
    where: {
      listingId: { in: listingIds },
      status: { in: ["approved", "active"] },
      OR: [{ startTime: { lte: now } }, { startTime: null }],
      AND: [{ OR: [{ endTime: { gte: now } }, { endTime: null }] }],
      flashSaleStock: { gt: 0 },
    },
  });

  const flashMap = {};
  activeFlashSales.forEach((fs) => { flashMap[fs.listingId] = fs; });

  return listings.map((l) => ({
    ...l,
    activeFlashSale: flashMap[l.id] || null,
  }));
};

const syncListingQuantity = (data) => {
  if (data.variations?.length > 0 && data.variations[0].options) {
    data.quantity = data.variations[0].options.reduce((s, o) => s + (Number(o.quantity) || 0), 0);
  }
};

const castNumericFields = (data) => {
  const fields = [
    "price", "startingBid", "currentBid", "reservePrice", "buyItNowPrice", "originalPrice",
    "quantity", "duration", "dealDiscountPercent", "bestOfferAutoAcceptPrice",
    "bestOfferAutoDeclinePrice", "charityPercent",
    "minimumOrderQuantity", "unitPrice", "bulkPrice", "availableQuantity",
    "minPrice", "maxPrice", "moqQuantity"
  ];

  fields.forEach(field => {
    if (data[field] === "") {
      data[field] = null;
    } else if (data[field] !== undefined && data[field] !== null) {
      const val = Number(data[field]);
      data[field] = isNaN(val) ? null : val;
    }
  });

  // Ensure non-negative validation for specific fields
  const nonNegativeFields = ["minimumOrderQuantity", "unitPrice", "bulkPrice", "availableQuantity"];
  nonNegativeFields.forEach(field => {
    if (data[field] !== null && data[field] !== undefined && data[field] < 0) {
      throw new Error(`${field} cannot be negative.`);
    }
  });

  // Boolean casting if they come as strings
  ["autoExtend", "isFeatured", "isDealOfTheDay", "isDigital", "isBestOfferEnabled",
    "isGlobalShipping", "isCharityListing", "isActive", "exportAvailable", "customQuoteAvailable", "isB2BProduct", "allowDirectOrder", "allowInquiry"].forEach(field => {
      if (typeof data[field] === "string") {
        const lower = data[field].toLowerCase();
        data[field] = lower === "true" || lower === "1" || lower === "on";
      }
    });
};

// POST /api/listings/visual-search
export const visualSearch = catchAsync(async (req, res, next) => {
  const { image, hint } = req.body;
  if (!image) return next(new AppError("No image provided.", 400));
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  // Try models in priority order
  const VISION_MODELS = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-1.5-pro", "gemini-2.0-flash"];

  try {
    const mimeType = image.match(/data:([^;]+);/)?.[1] || "image/jpeg";
    const base64Data = (image.includes(",") ? image.split(",")[1] : image).trim().replace(/\s/g, "");

    let text = null;
    for (const modelName of VISION_MODELS) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([
          `Identify this product. Return EXACTLY two things separated by a pipe (|): 1. A 3-5 word descriptive name. 2. A list of 5 search tags. Example: White Scented Candle | candle, white, wax, home, decor`,
          { inlineData: { data: base64Data, mimeType } },
        ]);
        text = result.response.text().trim();
        break;
      } catch (modelErr) {
        console.warn(`[visualSearch] Model ${modelName} failed:`, modelErr.message?.substring(0, 80));
      }
    }

    if (!text) throw new Error("All vision models failed");

    const [name, tags] = text.split("|").map((s) => s.trim());
    const keywords = [...new Set([...name.split(/\s+/), ...(tags || name).split(/[\s,]+/)])].filter((t) => t.length >= 2);

    const listings = await prisma.listing.findMany({
      where: {
        status: "active",
        OR: keywords.slice(0, 6).map((kw) => ({
          OR: [
            { title: { contains: kw, mode: "insensitive" } },
            { tags: { has: kw } },
            { brand: { contains: kw, mode: "insensitive" } },
          ],
        })),
      },
      include: { seller: { select: { createdAt: true, username: true, avatar: true, store: { select: { createdAt: true, storeSlug: true, storeName: true, logo: true } } } } },
      take: 24,
      orderBy: { views: "desc" },
    });

    const enriched = await enrichListingsWithFlash(listings);
    return sendSuccess(res, 200, "Visual analysis successful.", { data: { listings: enriched, aiDna: name } });
  } catch (err) {
    const fallback = await prisma.listing.findMany({ where: { status: "active" }, take: 10, orderBy: { createdAt: "desc" } });
    const enriched = await enrichListingsWithFlash(fallback);
    return sendSuccess(res, 200, "Search completed.", { data: { listings: enriched, aiDna: hint || "Visual Query", isSimulated: true } });
  }
});

// --- Helper: Generate smart fallback suggestions when AI is offline or quota is exceeded ---
const generateFallbackSuggestions = (imageUrls, availableCategories, availableSubcategories, errorMsg = "") => {
  let bestTitle = "";
  let tags = [];

  for (const url of imageUrls) {
    if (typeof url === "string" && url.startsWith("http")) {
      try {
        const parts = url.split("/");
        const lastPart = parts[parts.length - 1];
        const dotIndex = lastPart.lastIndexOf(".");
        let name = dotIndex !== -1 ? lastPart.substring(0, dotIndex) : lastPart;

        name = decodeURIComponent(name)
          .replace(/[_\-\+]+/g, " ")
          .replace(/\d{5,}/g, " ")  // replace long numbers with spaces
          .replace(/\s+/g, " ")
          .trim();

        const stopWords = new Set(["pexels", "photo", "by", "from", "img", "image", "pic", "captured", "product", "item", "stock", "original", "preview"]);
        const words = name.split(" ").filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));

        if (words.length > 0) {
          const titleCandidate = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
          if (titleCandidate.length > bestTitle.length) {
            bestTitle = titleCandidate;
            tags = [...new Set([...tags, ...words.map(w => w.toLowerCase())])];
          }
        }
      } catch (e) { }
    }
  }

  if (!bestTitle) {
    bestTitle = "New Product Listing";
    tags = ["product", "new", "listing"];
  }

  const title = bestTitle;
  const brand = tags.length > 0 ? (tags[0].charAt(0).toUpperCase() + tags[0].slice(1)) : "Generic";
  const model = tags.length > 1 ? tags[1].toUpperCase() : "";
  const subtitle = `High-quality ${title.toLowerCase()}`;
  const description = `This is a premium quality ${title.toLowerCase()}. It features a highly durable design, excellent craftsmanship, and top-tier materials. Perfect for daily use or as a special gift. Verified product listing with reliable performance.`;

  let matchedCategoryName = "";
  let matchedSubcategoryName = null;

  let bestCat = null;
  let maxCatScore = 0;
  for (const cat of availableCategories) {
    const catWords = cat.name.toLowerCase().split(/[\s&,/]+/);
    let score = 0;
    for (const tag of tags) {
      if (catWords.includes(tag)) {
        score += 10;
      } else if (catWords.some(cw => cw.includes(tag) || tag.includes(cw))) {
        score += 5;
      }
    }
    if (score > maxCatScore) {
      maxCatScore = score;
      bestCat = cat;
    }
  }

  if (bestCat) {
    matchedCategoryName = bestCat.name;
    let bestSub = null;
    let maxSubScore = 0;
    const subcats = availableSubcategories.filter(s => s.parentId?.toString() === bestCat.id?.toString());
    for (const sub of subcats) {
      const subWords = sub.name.toLowerCase().split(/[\s&,/]+/);
      let score = 0;
      for (const tag of tags) {
        if (subWords.includes(tag)) {
          score += 10;
        } else if (subWords.some(sw => sw.includes(tag) || tag.includes(sw))) {
          score += 5;
        }
      }
      if (score > maxSubScore) {
        maxSubScore = score;
        bestSub = sub;
      }
    }
    if (bestSub) {
      matchedSubcategoryName = bestSub.name;
    }
  } else if (availableCategories.length > 0) {
    matchedCategoryName = availableCategories[0].name;
    const subcats = availableSubcategories.filter(s => s.parentId?.toString() === availableCategories[0].id?.toString());
    if (subcats.length > 0) {
      matchedSubcategoryName = subcats[0].name;
    }
  }

  // --- Tiered keyword matching enhancement for produce/grocery ---
  const fruitKeywords = ["cherry", "cherries", "fruit", "food", "fresh", "organic", "apple", "berry", "strawberry", "produce", "grocery", "vegetable", "fruitage", "pic", "captured", "photo"];
  const groceryMatch = availableCategories.find(c =>
    c.name.toLowerCase().includes("food") ||
    c.name.toLowerCase().includes("fruit") ||
    c.name.toLowerCase().includes("produce") ||
    c.name.toLowerCase().includes("fresh") ||
    c.name.toLowerCase().includes("grocery")
  );

  if (groceryMatch && (tags.some(tag => fruitKeywords.includes(tag.toLowerCase())) || bestTitle.toLowerCase().includes("fruit") || bestTitle.toLowerCase().includes("cherry"))) {
    matchedCategoryName = groceryMatch.name;
    const subcats = availableSubcategories.filter(s => s.parentId?.toString() === groceryMatch.id?.toString());
    const subMatch = subcats.find(s =>
      s.name.toLowerCase().includes("fruit") ||
      s.name.toLowerCase().includes("fresh") ||
      s.name.toLowerCase().includes("produce") ||
      s.name.toLowerCase().includes("berry")
    );
    if (subMatch) matchedSubcategoryName = subMatch.name;
  }

  return {
    title: title.substring(0, 80),
    subtitle: subtitle.substring(0, 55),
    description,
    category: matchedCategoryName,
    subcategory: matchedSubcategoryName,
    brand,
    model,
    sku: "",
    upc: "",
    condition: "new",
    suggested_price: 99.99,
    tags: tags.slice(0, 10),
    materials: ["Standard Grade", "Mixed Materials"],
    weight_lb: 1.0,
    dimensions: { length: 1, width: 1, height: 1 },
    warranty: "Manufacturer Warranty",
    careInstructions: "Handle with standard care instructions",
    specifications: {
      "Material": "Quality Grade",
      "Type": title || "General"
    },
    isFallback: true,
    fallbackMessage: errorMsg || "AI analysis was unavailable, so basic fields were suggested from Image metadata."
  };
};

// POST /api/listings/suggest
export const suggestProductDetails = catchAsync(async (req, res, next) => {
  console.log("[DEBUG] suggestProductDetails triggered");
  let imageUrls = [];
  if (req.body.images && Array.isArray(req.body.images)) {
    imageUrls = req.body.images;
  } else if (req.body.image) {
    imageUrls = [req.body.image];
  }

  if (req.file) {
    const b64 = req.file.buffer.toString("base64");
    imageUrls.push(`data:${req.file.mimetype};base64,${b64}`);
  }

  if (imageUrls.length === 0) return next(new AppError("No images provided.", 400));

  const availableCategories = req.body.availableCategories || [];
  const availableSubcategories = req.body.availableSubcategories || [];

  if (!process.env.GEMINI_API_KEY) {
    console.warn("[suggestProductDetails] No GEMINI_API_KEY configured. Running smart fallback.");
    const fallbackData = generateFallbackSuggestions(imageUrls, availableCategories, availableSubcategories, "No AI key configured");
    return sendSuccess(res, 200, "No AI key configured. Local suggestions applied.", { data: fallbackData });
  }

  try {
    const imageParts = [];
    for (const url of imageUrls) {
      let base64Data, mimeType;
      if (url.startsWith("http")) {
        const getBase64FromUrl = (u) => new Promise((resolve, reject) => {
          const fetch = (u2) => https.get(u2, (r) => {
            if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return fetch(r.headers.location);
            const data = []; r.on("data", (c) => data.push(c)); r.on("end", () => resolve({ base64: Buffer.concat(data).toString("base64"), mimeType: (r.headers["content-type"] || "image/jpeg").split(";")[0] }));
          }).on("error", reject);
          fetch(u);
        });
        const result = await getBase64FromUrl(url);
        base64Data = result.base64; mimeType = result.mimeType;
      } else {
        base64Data = url.includes(",") ? url.split(",")[1] : url;
        mimeType = url.match(/data:([^;]+);/)?.[1] || "image/jpeg";
      }
      imageParts.push({ inlineData: { mimeType, data: base64Data.trim().replace(/\s/g, "") } });
    }

    const categoryListStr = availableCategories.length > 0
      ? `You MUST pick EXACTLY one of these category names (copy it exactly as written): ${availableCategories.map((c) => `"${c.name}"`).join(", ")}`
      : "Pick the most appropriate category name";

    const subcategoryListStr = availableSubcategories.length > 0
      ? `Pick EXACTLY one of these subcategory names or use null: ${availableSubcategories.map((c) => `"${c.name}"`).join(", ")}`
      : "Most specific subcategory name or null";

    const imageCount = imageParts.length;
    const prompt = {
      text: `You are an expert e-commerce product analyst. You are given ${imageCount} product image(s). Analyze ALL of them carefully together to identify the product and return a SINGLE JSON object with accurate details.

CRITICAL RULES:
- category field: ${categoryListStr}
- subcategory field: ${subcategoryListStr}  
- condition: must be exactly one of: "new", "used_excellent", "used_good", "for_parts"
- suggested_price: a realistic market price as a number (no currency symbol)
- tags: array of 5–10 lowercase keywords (e.g. ["sony", "headphones", "wireless", "noise-cancelling"])
- materials: array of strings (e.g. ["plastic", "metal", "leather"])
- dimensions: object with keys "length", "width", "height" all in inches as numbers
- weight_lb: product weight in pounds as a number
- specifications: object of key-value pairs for important product specs (e.g. {"Color": "Black", "Connectivity": "Bluetooth 5.0", "Battery Life": "30 hours"})
- sku: leave blank "" if not visible in image
- upc: leave blank "" if not visible in image
- All text fields (title, subtitle, description, brand, model, warranty, careInstructions) should be professional and detailed.
- IMPORTANT: Mahpahra Tecveq: According to the images.

Return ONLY a valid JSON object in this exact format (no markdown, no explanation):
{
  "title": "Full product name with key specs",
  "subtitle": "Brief compelling tagline under 55 characters",
  "description": "Detailed 3–5 sentence product description covering features, benefits, and condition",
  "category": "exact category name from the list",
  "subcategory": "exact subcategory name or null",
  "brand": "brand name or Generic",
  "model": "model number or name",
  "sku": "",
  "upc": "",
  "condition": "new",
  "suggested_price": 0,
  "tags": [],
  "materials": [],
  "weight_lb": 0,
  "dimensions": {"length": 0, "width": 0, "height": 0},
  "warranty": "warranty info or empty string",
  "careInstructions": "care instructions or empty string",
  "specifications": {}
}`
    };

    // Highly available and verified working vision models first to avoid 404/429 quota limits
    const VISION_MODELS = [
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-3.5-flash",
      "gemini-2.0-flash",
    ];
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY?.trim());

    let aiText = null;
    let lastError = null;

    for (const modelName of VISION_MODELS) {
      try {
        console.log(`[suggestProductDetails] Trying model: ${modelName}`);
        // Do NOT set responseMimeType — it conflicts with inline image data on most models
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([prompt, ...imageParts]);
        const text = result.response.text();
        if (text && text.trim().length > 10) {
          aiText = text;
          console.log(`[suggestProductDetails] ✅ Success with model: ${modelName}`);
          break;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[suggestProductDetails] ❌ Model ${modelName} failed:`, err.message?.substring(0, 120));
      }
    }

    if (!aiText) {
      throw new Error(lastError ? lastError.message : "All generative models failed to respond.");
    }

    let data;
    try {
      // Strip markdown code fences if present
      const cleanJson = aiText
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/gi, "")
        .trim();
      // Extract first JSON object if extra text surrounds it
      const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
      data = JSON.parse(jsonMatch ? jsonMatch[0] : cleanJson);
    } catch (err) {
      console.error("[suggestProductDetails] JSON parse failed:", err.message);
      throw new Error("AI response was not valid JSON.");
    }

    if (Array.isArray(data)) data = data[0];

    // Explicitly handle cases where Gemini returns an error object inside the 200 response
    if (data && data.error) {
      console.warn("[suggestProductDetails] Gemini returned error object:", data.error);
      const fallbackData = generateFallbackSuggestions(imageUrls, availableCategories, availableSubcategories, typeof data.error === 'string' ? data.error : "AI analysis quota reached");
      return sendSuccess(res, 200, "AI returned error. Fallback applied.", { data: fallbackData });
    }

    if (!data || Object.keys(data).length === 0) {
      throw new Error("Empty AI response received.");
    }

    return sendSuccess(res, 200, "Suggestions generated successfully.", { data });
  } catch (err) {
    console.error("[Suggest API Error]", err.message);
    const fallbackData = generateFallbackSuggestions(imageUrls, availableCategories, availableSubcategories, err.message);
    return sendSuccess(res, 200, "AI analysis unavailable (quota exceeded). Applied smart fallback.", { data: fallbackData });
  }
});

// POST /api/listings
export const createListing = catchAsync(async (req, res, next) => {
  req.body.sellerId = req.user.id;
  syncListingQuantity(req.body);

  // Map relation fields from frontend
  if (req.body.category) req.body.categoryId = req.body.category;
  if (req.body.subcategory !== undefined) req.body.subcategoryId = req.body.subcategory || null;

  const category = await prisma.category.findUnique({ where: { id: req.body.categoryId } });
  if (!category) return next(new AppError("Category not found.", 404));

  const status = req.body.status === "draft" ? "draft" : "pending_approval";
  if (req.body.listingType === "auction" || req.body.listingType === "buy_it_now_auction") {
    req.body.currentBid = req.body.startingBid;
  }

  // Clean up relation objects and forbidden fields
  const forbiddenFields = ["seller", "category", "subcategory", "isFeatured"];
  const data = { ...req.body };
  forbiddenFields.forEach(f => delete data[f]);

  const tierPrices = data.tierPrices;
  delete data.tierPrices;

  if (data.leadTime === "") data.leadTime = null;
  if (data.shippingFrom === "") data.shippingFrom = null;

  try {
    castNumericFields(data);
    const dealStatus = (req.body.isDealOfTheDay && req.user.role !== "admin") ? "pending" : "approved";

    const listing = await prisma.listing.create({
      data: {
        ...data,
        status,
        dealStatus,
        tierPrices: tierPrices && tierPrices.length > 0 ? {
          create: tierPrices.map(tp => ({
            minQty: Number(tp.minQty),
            maxQty: tp.maxQty ? Number(tp.maxQty) : null,
            price: Number(tp.price)
          }))
        } : undefined
      },
      include: {
        tierPrices: true
      }
    });

    await prisma.category.update({ where: { id: category.id }, data: { listingCount: { increment: 1 } } });

    sendSuccess(res, 201, "Listing created.", { data: { listing } });
  } catch (err) {
    return next(new AppError(err.message, 400));
  }
});

// GET /api/listings
export const getAllListings = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const { q, category, condition, minPrice, maxPrice, listingType, seller, sort, brand, isFeatured, deals, sale, verifiedSupplier, maxMoq, countries, businessTypes, productTypes } = req.query;

  const where = {};

  if (sale === "flash") {
    const now = new Date();
    const fs = await prisma.flashSale.findMany({
      where: {
        status: { in: ["approved", "active"] },
        flashSaleStock: { gt: 0 },
        OR: [{ startTime: { lte: now } }, { startTime: null }],
        AND: [{ OR: [{ endTime: { gte: now } }, { endTime: null }] }],
      },
      select: { listingId: true }
    });
    where.id = { in: fs.map((f) => f.listingId) };
    where.status = { in: ["active", "pending_approval"] };
  } else {
    where.status = "active";
    if (deals === "1") {
      where.isDealOfTheDay = true;
      where.dealStatus = "approved";
    }
  }

  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { tags: { hasSome: q.split(" ") } },
    ];
  }
  if (category) {
    where.AND = where.AND || [];
    where.AND.push({
      OR: [{ categoryId: category }, { subcategoryId: category }]
    });
  }
  if (condition) { where.condition = { in: condition.split(",") }; }
  if (listingType) { where.listingType = listingType; }
  if (seller) { where.sellerId = seller; }
  if (brand) { where.brand = { contains: brand, mode: "insensitive" }; }
  if (isFeatured === "true") { where.isFeatured = true; }
  if (minPrice || maxPrice) { where.price = {}; if (minPrice) where.price.gte = Number(minPrice); if (maxPrice) where.price.lte = Number(maxPrice); }

  if (verifiedSupplier === "true") {
    where.seller = { ...where.seller, store: { isVerified: true } };
  }
  if (maxMoq) {
    where.AND = where.AND || [];
    where.AND.push({
      OR: [
        { moqQuantity: { lte: parseInt(maxMoq) } },
        { moqQuantity: null }
      ]
    });
  }
  if (countries) {
    const countryList = countries.split(',').map(c => c.trim());
    if (countryList.length > 0) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { seller: { addresses: { some: { country: { in: countryList, mode: "insensitive" } } } } },
          { shippingFrom: { in: countryList, mode: "insensitive" } }
        ]
      });
    }
  }

  if (businessTypes) {
    const typeList = businessTypes.split(',').map(t => t.trim().toUpperCase());
    if (typeList.length > 0) {
      where.seller = {
        ...where.seller,
        businessType: { in: typeList }
      };
    }
  }

  if (productTypes) {
    const pTypes = productTypes.split(',').map(t => t.trim());
    if (pTypes.length > 0) {
      where.AND = where.AND || [];
      const ptConditions = [];

      if (pTypes.includes('ready_to_ship')) {
        ptConditions.push({ allowDirectOrder: true });
      }
      if (pTypes.includes('customizable')) {
        ptConditions.push({ customQuoteAvailable: true });
      }
      if (pTypes.includes('in_stock')) {
        ptConditions.push({ quantity: { gt: 0 } });
      }
      if (pTypes.includes('new_arrival')) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        ptConditions.push({ createdAt: { gte: thirtyDaysAgo } });
      }
      if (pTypes.includes('best_seller')) {
        ptConditions.push({ quantitySold: { gte: 20 } });
      }

      if (ptConditions.length > 0) {
        where.AND.push({ OR: ptConditions });
      }
    }
  }

  const sortMap = { newest: { createdAt: "desc" }, oldest: { createdAt: "asc" }, price_asc: { price: "asc" }, price_desc: { price: "desc" }, most_watched: { watchers: "desc" }, most_viewed: { views: "desc" } };
  const baseOrderBy = sortMap[sort] || { createdAt: "desc" };
  const orderBy = [{ isFeatured: "desc" }, baseOrderBy];

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      include: {
        seller: { select: { createdAt: true, id: true, username: true, name: true, avatar: true, feedbackScore: true, positiveFeedbackPercent: true, store: { select: { createdAt: true, storeSlug: true, storeName: true, logo: true, isVerified: true, verificationData: true, companyInfo: true } }, addresses: { select: { country: true }, take: 1 } } },
        category: { select: { name: true, slug: true } },
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.listing.count({ where }),
  ]);

  const enriched = await enrichListingsWithFlash(listings);
  sendSuccess(res, 200, "Listings fetched.", { data: { listings: enriched, total, page, pages: Math.ceil(total / limit) } });
});

// GET /api/listings/search/suggestions
export const getSearchSuggestions = catchAsync(async (req, res) => {
  const { q } = req.query;
  if (!q) return sendSuccess(res, 200, "No query.", { data: { suggestions: [] } });

  const [products, categories] = await Promise.all([
    prisma.listing.findMany({ where: { status: "active", title: { contains: q, mode: "insensitive" } }, select: { title: true }, distinct: ["title"], take: 8 }),
    prisma.category.findMany({ where: { name: { startsWith: q, mode: "insensitive" } }, select: { name: true }, take: 3 }),
  ]);

  const suggestions = [...categories.map((c) => `In Category: ${c.name}`), ...products.map((p) => p.title)].slice(0, 10);
  sendSuccess(res, 200, "Suggestions fetched.", { data: { suggestions } });
});

// GET /api/listings/:id
export const getListing = catchAsync(async (req, res, next) => {
  const listing = await prisma.listing.findUnique({
    where: { id: req.params.id },
    include: {
      seller: { select: { createdAt: true, id: true, username: true, avatar: true, feedbackScore: true, positiveFeedbackPercent: true, registeredSeller: true, sellerLevel: true, businessType: true, BusinessVerification: { select: { verificationStatus: true } }, store: { select: { createdAt: true, storeSlug: true, storeName: true, logo: true, status: true } } } },
      category: { select: { name: true, slug: true, ancestors: true } },
      tierPrices: {
        orderBy: {
          minQty: "asc"
        }
      }
    },
  });

  if (!listing) return next(new AppError("Listing not found.", 404));
  if (listing.status === "suspended" && req.user?.role !== "admin") return next(new AppError("This listing is not available.", 403));

  await prisma.listing.update({ where: { id: req.params.id }, data: { views: { increment: 1 } } });

  const now = new Date();
  const activeFlashSale = await prisma.flashSale.findFirst({
    where: { listingId: listing.id, status: { in: ["approved", "active"] }, flashSaleStock: { gt: 0 }, OR: [{ startTime: { lte: now } }, { startTime: null }], AND: [{ OR: [{ endTime: { gte: now } }, { endTime: null }] }] },
  });

  sendSuccess(res, 200, "Listing fetched.", { data: { listing: { ...listing, activeFlashSale: activeFlashSale || null } } });
});

// PATCH /api/listings/:id
export const updateListing = catchAsync(async (req, res, next) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) return next(new AppError("Listing not found.", 404));
  if (listing.sellerId !== req.user.id && req.user.role !== "admin") return next(new AppError("Not authorized.", 403));

  if (listing.listingType === "auction" && listing.bidCount > 0 && listing.status === "active") {
    const restricted = ["startingBid", "reservePrice", "listingType"].some((f) => req.body[f] !== undefined);
    if (restricted) return next(new AppError("Cannot modify pricing on an active auction with bids.", 400));
  }

  // Map relation fields from frontend
  if (req.body.category) req.body.categoryId = req.body.category;
  if (req.body.subcategory !== undefined) req.body.subcategoryId = req.body.subcategory || null;

  const forbiddenFields = ["sellerId", "bidCount", "views", "quantitySold", "id", "createdAt", "updatedAt", "seller", "category", "subcategory", "isFeatured"];
  const data = { ...req.body };
  forbiddenFields.forEach((f) => delete data[f]);

  // If a non-admin seller changes deal settings, require re-approval
  if (req.user.role !== "admin") {
    if (
      (data.isDealOfTheDay !== undefined && data.isDealOfTheDay !== listing.isDealOfTheDay) ||
      (data.dealDiscountPercent !== undefined && data.dealDiscountPercent !== listing.dealDiscountPercent)
    ) {
      if (data.isDealOfTheDay) {
        data.dealStatus = "pending";
      }
    }
  }

  const tierPrices = data.tierPrices;
  delete data.tierPrices;

  if (data.subcategoryId === "") data.subcategoryId = null;
  if (data.leadTime === "") data.leadTime = null;
  if (data.shippingFrom === "") data.shippingFrom = null;

  syncListingQuantity(data);

  try {
    castNumericFields(data);

    if (tierPrices !== undefined) {
      await prisma.tierPrice.deleteMany({ where: { listingId: req.params.id } });
    }

    const updated = await prisma.listing.update({
      where: { id: req.params.id },
      data: {
        ...data,
        tierPrices: tierPrices && tierPrices.length > 0 ? {
          create: tierPrices.map(tp => ({
            minQty: Number(tp.minQty),
            maxQty: tp.maxQty ? Number(tp.maxQty) : null,
            price: Number(tp.price)
          }))
        } : undefined
      },
      include: {
        tierPrices: true
      }
    });

    sendSuccess(res, 200, "Listing updated.", { data: { listing: updated } });
  } catch (err) {
    return next(new AppError(err.message, 400));
  }
});

// DELETE /api/listings/:id
export const deleteListing = catchAsync(async (req, res, next) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) return next(new AppError("Listing not found.", 404));
  if (listing.sellerId !== req.user.id && req.user.role !== "admin") return next(new AppError("Not authorized.", 403));
  if (listing.status === "active" && listing.bidCount > 0) return next(new AppError("Cannot delete an active auction with bids.", 400));

  await prisma.flashSale.deleteMany({ where: { listingId: listing.id } });
  await prisma.listing.delete({ where: { id: listing.id } });
  await prisma.category.update({ where: { id: listing.categoryId }, data: { listingCount: { decrement: 1 } } });

  sendSuccess(res, 200, "Listing deleted.");
});

// DELETE /api/listings/batch
export const deleteBatchListings = catchAsync(async (req, res, next) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return next(new AppError("No IDs provided", 400));

  // Find categories to update count
  const listings = await prisma.listing.findMany({
    where: { id: { in: ids }, sellerId: req.user.id },
    select: { categoryId: true, id: true }
  });

  const validIds = listings.map(l => l.id);
  if (validIds.length === 0) return next(new AppError("No valid listings found for deletion", 404));

  // Update category counts
  const categoryCounts = {};
  listings.forEach(l => {
    categoryCounts[l.categoryId] = (categoryCounts[l.categoryId] || 0) + 1;
  });

  await prisma.flashSale.deleteMany({ where: { listingId: { in: validIds } } });
  await prisma.listing.deleteMany({ where: { id: { in: validIds } } });

  for (const [catId, count] of Object.entries(categoryCounts)) {
    await prisma.category.update({ where: { id: catId }, data: { listingCount: { decrement: count } } });
  }

  sendSuccess(res, 204, "Listings deleted.");
});

// PATCH /api/listings/:id/publish
export const publishListing = catchAsync(async (req, res, next) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) return next(new AppError("Listing not found.", 404));
  if (listing.sellerId !== req.user.id && req.user.role !== "admin") return next(new AppError("Not authorized.", 403));
  if (listing.status !== "draft") return next(new AppError("Only draft listings can be published.", 400));

  const updated = await prisma.listing.update({ where: { id: req.params.id }, data: { status: "pending_approval" } });
  sendSuccess(res, 200, "Listing submitted for approval.", { data: { listing: updated } });
});

// PATCH /api/listings/:id/end
export const endListing = catchAsync(async (req, res, next) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) return next(new AppError("Listing not found.", 404));
  if (listing.sellerId !== req.user.id && req.user.role !== "admin") return next(new AppError("Not authorized.", 403));

  const updated = await prisma.listing.update({ where: { id: req.params.id }, data: { status: "ended", endTime: new Date() } });
  sendSuccess(res, 200, "Listing ended.", { data: { listing: updated } });
});

// GET /api/listings/my-listings
export const getMyListings = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = { sellerId: req.user.id };
  if (req.query.status) where.status = req.query.status;
  if (req.query.deals === "1") where.isDealOfTheDay = true;
  if (req.query.simple === "1") {
    where.isDealOfTheDay = false;
    where.flashSales = { none: { status: { in: ["pending", "approved", "active"] } } };
  }
  if (req.query.q) {
    where.OR = [
      { title: { contains: req.query.q, mode: "insensitive" } },
      { description: { contains: req.query.q, mode: "insensitive" } },
      { brand: { contains: req.query.q, mode: "insensitive" } },
    ];
  }

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({ where, include: { category: { select: { name: true, slug: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.listing.count({ where }),
  ]);

  const enriched = await enrichListingsWithFlash(listings);
  sendSuccess(res, 200, "Your listings fetched.", { data: { listings: enriched, total, page, pages: Math.ceil(total / limit) } });
});

// POST /api/listings/:id/watch
export const toggleWatch = catchAsync(async (req, res, next) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) return next(new AppError("Listing not found.", 404));

  const userId = req.user.id;
  const isWatching = listing.watchersList.includes(userId);

  const updatedWatchersList = isWatching
    ? listing.watchersList.filter((id) => id !== userId)
    : [...listing.watchersList, userId];

  await prisma.listing.update({
    where: { id: req.params.id },
    data: { watchersList: updatedWatchersList, watchers: isWatching ? Math.max(0, listing.watchers - 1) : listing.watchers + 1 },
  });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { watchlist: true } });
  const newWatchlist = isWatching ? user.watchlist.filter((id) => id !== listing.id) : [...user.watchlist, listing.id];
  await prisma.user.update({ where: { id: userId }, data: { watchlist: newWatchlist } });

  sendSuccess(res, 200, isWatching ? "Removed from watchlist." : "Added to watchlist.", { data: { isWatching: !isWatching, watchers: updatedWatchersList.length } });
});

// GET /api/listings/watchlist
export const getWatchlist = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { watchlist: true } });
  const total = user.watchlist.length;
  const listings = await prisma.listing.findMany({
    where: { id: { in: user.watchlist.slice(skip, skip + limit) } },
    include: { seller: { select: { createdAt: true, username: true, store: { select: { createdAt: true, storeSlug: true } } } } },
  });
  const enriched = await enrichListingsWithFlash(listings);
  sendSuccess(res, 200, "Watchlist fetched.", { data: { listings: enriched, total, page, pages: Math.ceil(total / limit) } });
});

// GET /api/listings/:id/related
export const getRelatedListings = catchAsync(async (req, res, next) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id }, select: { id: true, categoryId: true } });
  if (!listing) return next(new AppError("Listing not found.", 404));

  const related = await prisma.listing.findMany({
    where: { id: { not: listing.id }, categoryId: listing.categoryId, status: "active" },
    include: { seller: { select: { createdAt: true, username: true, name: true, avatar: true, feedbackScore: true, store: { select: { createdAt: true, storeSlug: true, storeName: true, logo: true } } } } },
    take: 12,
  });
  sendSuccess(res, 200, "Related listings fetched.", { data: { listings: related } });
});

// GET /api/listings/deals-of-the-day
export const getDealsOfTheDay = catchAsync(async (req, res) => {
  try {
    const listings = await prisma.listing.findMany({
      where: { status: "active", isDealOfTheDay: true },
      include: { seller: { select: { createdAt: true, username: true, name: true, avatar: true, store: { select: { createdAt: true, storeSlug: true, storeName: true, logo: true } } } }, category: { select: { name: true, slug: true } } },
      take: 10,
    });
    const enriched = await enrichListingsWithFlash(listings);
    sendSuccess(res, 200, "Deals of the Day fetched.", { data: { listings: enriched } });
  } catch (err) {
    console.error("[getDealsOfTheDay] Error:", err?.message);
    sendSuccess(res, 200, "Deals of the Day fetched.", { data: { listings: [] } });
  }
});

// GET /api/listings/featured
export const getFeaturedListings = catchAsync(async (req, res) => {
  try {
    const listings = await prisma.listing.findMany({
      where: { status: "active", isFeatured: true },
      include: { seller: { select: { createdAt: true, username: true, name: true, avatar: true, store: { select: { createdAt: true, storeSlug: true, storeName: true, logo: true } } } } },
      take: 20,
    });
    const enriched = await enrichListingsWithFlash(listings);
    sendSuccess(res, 200, "Featured listings fetched.", { data: { listings: enriched } });
  } catch (err) {
    console.error("[getFeaturedListings] Error:", err?.message);
    sendSuccess(res, 200, "Featured listings fetched.", { data: { listings: [] } });
  }
});

// GET /api/listings/grouped-by-category
export const getListingsByCategory = catchAsync(async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: { listingCount: "desc" },
      take: 12,
      select: { id: true, name: true, slug: true, listingCount: true },
    });

    if (!categories.length) return sendSuccess(res, 200, "Grouped listings fetched.", { data: { groups: [] } });

    const categoryIds = categories.map((c) => c.id);

    // Single bulk query for all listings across all categories
    const allListings = await prisma.listing.findMany({
      where: { categoryId: { in: categoryIds }, status: "active", isDealOfTheDay: false },
      include: {
        seller: { select: { createdAt: true, username: true, name: true, avatar: true, store: { select: { createdAt: true, storeSlug: true, storeName: true, logo: true } } } },
        category: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 240, // max 20 per category × 12 categories
    });

    // Single bulk flash sale enrichment
    const enriched = await enrichListingsWithFlash(allListings);

    // Group in memory — max 20 per category
    const grouped = {};
    enriched.forEach((l) => {
      if (!grouped[l.categoryId]) grouped[l.categoryId] = [];
      if (grouped[l.categoryId].length < 20) grouped[l.categoryId].push(l);
    });

    const groups = categories
      .map((cat) => ({ category: cat, listings: grouped[cat.id] || [] }))
      .filter((g) => g.listings.length > 0);

    sendSuccess(res, 200, "Grouped listings fetched.", { data: { groups } });
  } catch (err) {
    console.error("[getListingsByCategory] Error:", err?.message);
    sendSuccess(res, 200, "Grouped listings fetched.", { data: { groups: [] } });
  }
});

// PATCH /api/listings/:id/suspend
export const suspendListing = catchAsync(async (req, res, next) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) return next(new AppError("Listing not found.", 404));

  const newStatus = listing.status === "suspended" ? "active" : "suspended";
  const updated = await prisma.listing.update({ where: { id: req.params.id }, data: { status: newStatus } });
  sendSuccess(res, 200, `Listing ${newStatus}.`, { data: { listing: updated } });
});

// ─── Helper: Smart hint-based keyword search when AI is unavailable ───────────
const runSmartHintSearch = async (res, hint) => {
  // Clean the hint filename into search keywords
  const cleaned = (hint || "")
    .toLowerCase()
    .replace(/\.(jpg|jpeg|png|webp|gif|avif|heic)$/i, "")
    .replace(/[_\-\.]+/g, " ")
    .replace(/\d{5,}/g, "")  // remove long numbers (Pexels IDs etc)
    .trim();

  const stopWords = new Set(["pexels", "photo", "by", "from", "img", "image", "pic", "captured", "photo", "product", "item", "the", "a", "an", "and", "of", "for", "with"]);
  const hintWords = cleaned.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

  // All active listings for scoring
  const allListings = await prisma.listing.findMany({
    where: { status: "active" },
    include: { seller: { select: { username: true, avatar: true } }, category: { select: { name: true } } },
  });

  if (hintWords.length === 0) {
    // No usable keywords - return newest listings
    const fallback = allListings.slice(0, 12);
    const enriched = await enrichListingsWithFlash(fallback);
    return res.status(200).json({ success: true, query_used: "Popular Products", fallback_used: true, products: enriched });
  }

  // Score every listing against hint keywords
  const scored = allListings.map(product => {
    const titleLower = product.title.toLowerCase();
    const descLower = (product.description || "").toLowerCase();
    const tagsLower = (product.tags || []).map(t => t.toLowerCase());
    const catLower = (product.category?.name || "").toLowerCase();
    const brandLower = (product.brand || "").toLowerCase();
    let score = 0;

    hintWords.forEach(word => {
      if (titleLower.includes(word)) score += 40;
      else if (tagsLower.some(t => t.includes(word))) score += 30;
      else if (catLower.includes(word)) score += 20;
      else if (brandLower.includes(word)) score += 15;
      else if (descLower.includes(word)) score += 5;
    });

    return { ...product, _score: score };
  });

  let results = scored.filter(p => p._score > 0).sort((a, b) => b._score - a._score).slice(0, 24);

  // If no keyword match at all - return top listings
  if (results.length === 0) {
    results = allListings.slice(0, 12);
  }

  const clean = results.map(({ _score, ...rest }) => rest);
  const enriched = await enrichListingsWithFlash(clean);
  const queryUsed = hintWords.slice(0, 3).join(" ") || "Popular Products";
  return res.status(200).json({ success: true, query_used: queryUsed, fallback_used: true, products: enriched });
};

// ─── Helper: Call Gemini vision model with auto-retry on different models ──────
const analyzeImageWithGemini = async (base64Data, mimeType, apiKey) => {
  // Highly available and verified working vision models first to avoid 404/429 quota limits
  const VISION_MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "gemini-2.0-flash",
  ];
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError = null;

  for (const modelName of VISION_MODELS) {
    try {
      console.log(`[imageSearch] Trying model: ${modelName}`);
      // Do NOT set responseMimeType — it conflicts with inline image data on most models
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent([
        `Identify the MAIN product in the image. Return ONLY a JSON object:
        {
          "object": "single core noun representing the product, e.g. 'bangle', 'handbag', 'lipstick'",
          "search_phrase": "a descriptive, detailed search phrase for the product, e.g. 'Traditional Indian Gold Studded Bangles'",
          "category": "the single best category name chosen from this exact list: mobile, Furniture, Home Decor, Makeup, laptop, electronics, Shirts, Shoes, Dresses, Handbags, Boys Clothing, Girls Clothing, Skincare, Gym Equipment, Sports Shoes, Kids Fashion, Women Fashion, Accessories, Beauty & Personal Care, food, Sports & Fitness, Home & Living, Pet Supplies, Automotive, Books & Stationery, Toys & Games, Health & Wellness, Men Fashion",
          "core_synonyms": ["list of 3-5 closely related singular or plural synonyms or search terms, e.g. ['bangles', 'bangle', 'bracelet', 'jewelry', 'ornament']"]
        }`,
        { inlineData: { data: base64Data.trim().replace(/\s/g, ""), mimeType } }
      ]);
      const parsed = JSON.parse(result.response.text().match(/{[\s\S]*}/)?.[0]);
      if (!parsed?.object || !parsed?.search_phrase) throw new Error("AI returned incomplete data.");
      console.log(`[imageSearch] ✅ Success with ${modelName}: "${parsed.search_phrase}"`);
      return { success: true, data: parsed, modelUsed: modelName };
    } catch (err) {
      lastError = err;
      console.warn(`[imageSearch] ❌ ${modelName} failed:`, err.message?.substring(0, 100));
    }
  }

  return { success: false, error: lastError };
};

// POST /api/listings/image-search
export const imageSearch = catchAsync(async (req, res, next) => {
  let base64Data, mimeType = "image/jpeg";
  if (req.file) {
    base64Data = req.file.buffer.toString("base64");
    mimeType = req.file.mimetype;
  } else if (req.body.image) {
    base64Data = req.body.image.includes(",") ? req.body.image.split(",")[1] : req.body.image;
    mimeType = req.body.image.match(/data:([^;]+);/)?.[1] || "image/jpeg";
  }

  const hint = req.body.hint || "";

  // If no image data or mock placeholder — use hint-based fallback directly
  if (!base64Data || base64Data === "mock_image") {
    return runSmartHintSearch(res, hint);
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();

  // If no API key — use hint-based fallback
  if (!apiKey) {
    console.warn("[imageSearch] No GEMINI_API_KEY configured. Using hint fallback.");
    return runSmartHintSearch(res, hint);
  }

  // Step 1: Try to analyze the image with Gemini (multi-model fallback chain)
  const aiResult = await analyzeImageWithGemini(base64Data, mimeType, apiKey);

  // Step 2: If ALL AI models failed — gracefully fall back to hint search (no error screen)
  if (!aiResult.success) {
    console.warn("[imageSearch] All Gemini models failed. Using smart hint fallback.");
    return runSmartHintSearch(res, hint);
  }

  // Step 3: AI succeeded — run high-precision product matching
  const { object, search_phrase, category, core_synonyms = [] } = aiResult.data;

  try {
    // Fetch active flash sale listing IDs
    const now = new Date();
    const activeFlashSales = await prisma.flashSale.findMany({
      where: {
        status: { in: ["approved", "active"] },
        flashSaleStock: { gt: 0 },
        OR: [{ startTime: { lte: now } }, { startTime: null }],
        AND: [{ OR: [{ endTime: { gte: now } }, { endTime: null }] }],
      },
      select: { listingId: true }
    });
    const flashSaleListingIds = activeFlashSales.map(f => f.listingId);

    // Load all eligible products
    const products = await prisma.listing.findMany({
      where: { OR: [{ status: "active" }, { id: { in: flashSaleListingIds } }] },
      include: { seller: { select: { username: true, avatar: true } }, category: { select: { name: true } } },
    });

    const cleanCategoryName = (name) => name.toLowerCase().replace(/\s+/g, " ").trim();
    const cleanObject = object.toLowerCase().trim();
    const cleanSynonyms = core_synonyms.map(s => s.toLowerCase().trim()).filter(s => s !== "accessories" && s !== "accessory");
    const coreKeywords = [cleanObject, ...cleanSynonyms];

    const stopWords = ["set", "product", "item", "traditional", "indian", "new", "pack", "piece", "pcs", "and", "with", "for", "the", "a", "an"];
    const searchPhraseWords = search_phrase
      ? search_phrase.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w))
      : [];

    const geminiCatClean = cleanCategoryName(category || "");

    const scoredProducts = products.map(product => {
      let score = 0;
      let coreMatch = false;
      let secondaryMatchCount = 0;

      const titleLower = product.title.toLowerCase();
      const descLower = product.description ? product.description.toLowerCase() : "";
      const tagsLower = product.tags ? product.tags.map(t => t.toLowerCase()) : [];
      const catClean = product.category?.name ? cleanCategoryName(product.category.name) : "";

      // 1. Core Keyword / Synonym Match
      coreKeywords.forEach(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, "i");
        if (regex.test(titleLower)) { score += 40; coreMatch = true; }
        else if (tagsLower.includes(kw)) { score += 30; coreMatch = true; }
        else if (regex.test(descLower)) { score += 15; coreMatch = true; }
      });

      // 2. Secondary search phrase words
      searchPhraseWords.forEach(word => {
        if (coreKeywords.includes(word)) return;
        const regex = new RegExp(`\\b${word}\\b`, "i");
        if (regex.test(titleLower)) { score += 15; secondaryMatchCount++; }
        else if (tagsLower.includes(word)) { score += 10; secondaryMatchCount++; }
        else if (regex.test(descLower)) { score += 5; secondaryMatchCount++; }
      });

      // 3. Category match boost
      let isCategoryMatch = false;
      if (catClean && geminiCatClean && (catClean === geminiCatClean || catClean.includes(geminiCatClean) || geminiCatClean.includes(catClean))) {
        score += 20;
        isCategoryMatch = true;
      }

      const isRelevant = coreMatch || (isCategoryMatch && secondaryMatchCount > 0);
      return { ...product, _score: isRelevant ? score : 0, _isRelevant: isRelevant };
    });

    let filteredProducts = scoredProducts
      .filter(p => p._isRelevant && p._score >= 25)
      .sort((a, b) => b._score - a._score)
      .slice(0, 24);

    // If AI found no matches → fall back to hint search (avoids empty screen)
    if (filteredProducts.length === 0) {
      console.warn("[imageSearch] AI matched 0 products. Falling back to hint search.");
      return runSmartHintSearch(res, hint);
    }

    filteredProducts = filteredProducts.map(p => { const { _score, _isRelevant, ...rest } = p; return rest; });
    const enriched = await enrichListingsWithFlash(filteredProducts);

    return res.status(200).json({
      success: true,
      query_used: search_phrase || object,
      fallback_used: false,
      products: enriched
    });
  } catch (err) {
    console.error("[imageSearch] DB scoring error:", err.message);
    return runSmartHintSearch(res, hint);
  }
});




