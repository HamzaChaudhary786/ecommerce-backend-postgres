import "./loadEnv.js"; // [RESTARTED SERVER TO SYNC PRISMA]
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import xss from "xss-clean";
import hpp from "hpp";
import compression from "compression";
import morgan from "morgan";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db.js";
import { initSocket } from "./socket.js";
import pg from "pg";

import configurePassport from "./config/passport.js";

// Import Routes

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import listingRoutes from "./routes/listingRoutes.js";
import bidRoutes from "./routes/bidRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import offerRoutes from "./routes/offerRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import storeRoutes from "./routes/storeRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import disputeRoutes from "./routes/disputeRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import mediaRoutes from "./routes/mediaRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import questionRoutes from "./routes/questionRoutes.js";
import supportRoutes from "./routes/supportRoutes.js";
import flashSaleRoutes from "./routes/flashSaleRoutes.js";
import inquiryRoutes from "./routes/inquiryRoutes.js";
import businessVerificationRoutes from "./routes/businessVerificationRoutes.js";
import quotationRoutes from "./routes/quotationRoutes.js";
import rfqRoutes from "./routes/rfqRoutes.js";
import homeRoutes from "./routes/homeRoutes.js";
import businessHubRoutes from "./routes/businessHubRoutes.js";
import { handleStripeWebhook } from "./controllers/webhookController.js";

// Import Cron Jobs
import "./utils/auctionCron.js";
import "./utils/flashSaleCron.js";
import "./utils/rfqCron.js";

import errorHandler from "./middleware/errorHandler.js";
import { AppError } from "./utils/helpers.js";

const app = express();
const httpServer = createServer(app);

// Trust proxy for cross-domain cookies on platforms like Render/Heroku
app.set("trust proxy", 1);

const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || true, credentials: true },
  path: "/socket.io/",
});
initSocket(io);

// ─── 1. SECURITY & MIDDLEWARE ────────────────────────────────────────────────
app.use(cors({
  origin: true, // This allows any origin and reflects it back, which is great for local network testing (e.g. 192.168.x.x)
  credentials: true
}));

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
  })
);
app.use(compression());

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Stripe Webhook (Must use raw body for signature verification)
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));
app.use(cookieParser());
app.use(xss());
app.use(hpp());

// ─── Session with PostgreSQL store ───────────────────────────────────────────
const PgSession = connectPgSimple(session);

const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

app.use(
  session({
    store: new PgSession({
      pool: pgPool,
      tableName: "session",
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 15,
      disableTouch: true,
    }),
    secret: process.env.SESSION_SECRET || "shop_vault_secret_2024",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

// Passport
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  message: "Too many requests from this IP, please try again after 15 minutes",
});
app.use("/api", limiter);

// ─── 2. ROUTES ───────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/bids", bidRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/disputes", disputeRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/flash-sales", flashSaleRoutes);
app.use("/api/inquiries", inquiryRoutes);
app.use("/api/business-hubs", businessHubRoutes);
app.use("/api/business-verification", businessVerificationRoutes);
app.use("/api/b2b-quotations", quotationRoutes);
app.use("/api/rfq", rfqRoutes);
app.use("/api/home", homeRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "ShopVault API",
    environment: process.env.NODE_ENV || "development",
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString(),
  });
});

// Root route
app.get("/", (req, res) => {
  res.json({ service: "ShopVault API", version: "1.0.0", status: "running" });
});

// 404 handler
app.all("*", (req, res, next) => {
  console.log(`[404 NOT FOUND fallback caught]: ${req.method} ${req.originalUrl}`);
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handler
app.use(errorHandler);

// ─── 3. SERVER START ─────────────────────────────────────────────────────────
connectDB();

const PORT = process.env.PORT || 5000;
const server = httpServer.listen(PORT, () => {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║       🛒  ShopVault API Server       ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`  🌍  Environment : ${process.env.NODE_ENV || "development"}`);
  console.log(`  🚀  Port        : ${PORT}`);
  console.log(`  🏥  Health      : http://localhost:${PORT}/api/health`);
  console.log("  ──────────────────────────────────────\n");
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.log(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});

// Trigger nodemon restart