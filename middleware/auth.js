import jwt from "jsonwebtoken";
import { catchAsync, AppError } from "../utils/helpers.js";
import prisma from "../config/db.js";

/**
 * Protect routes - ensures user is logged in
 */
export const protect = catchAsync(async (req, res, next) => {
  // Debug log (remove in production)
  if (process.env.NODE_ENV === "development") {
    console.log(`[Auth Debug] Path: ${req.path}`);
    console.log(`[Auth Debug] Authenticated: ${req.isAuthenticated ? req.isAuthenticated() : "N/A"}`);
    console.log(`[Auth Debug] Session ID: ${req.sessionID}`);
    console.log(`[Auth Debug] Has User in Session: ${!!req.session?.passport?.user}`);
    console.log(`[Auth Debug] Has req.user: ${!!req.user}`);
    if (req.cookies) console.log(`[Auth Debug] Cookies:`, Object.keys(req.cookies));
  }

  // 1. Passport Session Check
  if (req.isAuthenticated && req.isAuthenticated()) {
    if (req.user.isSuspended) {
      return next(new AppError("Your account has been suspended. Please contact support.", 403));
    }
    return next();
  }

  // 2. Fallback: JWT Token Check
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (!token || token === "null" || token === "undefined") {
    return next(new AppError("You are not logged in. Please log in to get access.", 401));
  }

  // Verify token
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return next(new AppError("Invalid or expired token. Please log in again.", 401));
  }

  // Check if user still exists
  const currentUser = await prisma.user.findUnique({ where: { id: decoded.id } });
  if (!currentUser) {
    return next(new AppError("The user belonging to this token no longer exists.", 401));
  }

  // Check if user is suspended
  if (currentUser.isSuspended) {
    return next(new AppError("Your account has been suspended. Please contact support.", 403));
  }

  req.user = currentUser;
  next();
});

/**
 * Optional authentication - sets req.user if token is present, but doesn't block
 */
export const optionalAuth = catchAsync(async (req, res, next) => {
  // 1. Passport Session Check
  if (req.isAuthenticated && req.isAuthenticated() && !req.user.isSuspended) {
    return next();
  }

  // 2. Fallback: JWT Token Check
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (token && token !== "null" && token !== "undefined") {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const currentUser = await prisma.user.findUnique({ where: { id: decoded.id } });
      if (currentUser && !currentUser.isSuspended) {
        req.user = currentUser;
      }
    } catch (err) {
      // Ignore errors for optional auth
    }
  }
  next();
});

/**
 * Restrict to certain roles
 */
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError("You do not have permission to perform this action.", 403));
    }
    next();
  };
};

/**
 * Middleware for seller-only routes
 */
export const sellerOnly = (req, res, next) => {
  if (req.user.role !== "seller" && req.user.role !== "admin") {
    return next(new AppError("Only sellers can access this route.", 403));
  }
  next();
};
