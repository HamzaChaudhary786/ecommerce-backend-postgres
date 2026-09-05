import bcrypt from "bcryptjs";
import passport from "passport";
import jwt from "jsonwebtoken";
import prisma from "../config/db.js";
import { catchAsync, AppError, sendSuccess } from "../utils/helpers.js";
import crypto from "crypto";
import { sendVerificationEmail } from "../utils/emailService.js";

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
export const registerUser = catchAsync(async (req, res, next) => {
  const { username, email: rawEmail, password, name, firstName, lastName, role, businessType } = req.body;
  const email = rawEmail?.toLowerCase().trim();

  // Case-insensitive check
  const userExists = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (userExists) return next(new AppError("User already exists", 400));

  let finalRole = role || "buyer";
  if (finalRole === "admin" || finalRole === "subadmin") {
    finalRole = "buyer";
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  // Generate verification token
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const tokenExpiry = new Date(Date.now() + 3600000); // 1 hour

  const user = await prisma.user.create({
    data: {
      username: username || email.split("@")[0],
      email,
      password: hashedPassword,
      name,
      firstName,
      lastName,
      role: finalRole,
      isVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: tokenExpiry,
      businessType: businessType || null,
    },
  });

  // Send Verification Email
  const displayName = user.name || [user.firstName, user.lastName].filter(Boolean).join(" ") || "User";
  try {
    await sendVerificationEmail(user.email, displayName, verificationToken);
  } catch (emailErr) {
    console.error("Failed to send initial verification email:", emailErr.message);
    // Continue anyway, user can resend it later
  }

  sendSuccess(res, 201, "Account created successfully. Please verify your email before login.", {
    data: {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        businessType: user.businessType
      },
    },
  });
});

// @desc    Verify email address
// @route   GET /api/auth/verify-email
// @access  Public
export const verifyEmail = catchAsync(async (req, res, next) => {
  const { token } = req.query;

  if (!token) return next(new AppError("Verification token is required", 400));

  const user = await prisma.user.findFirst({
    where: {
      emailVerificationToken: token,
      emailVerificationExpires: { gt: new Date() }
    }
  });

  if (!user) {
    return next(new AppError("Verification link is invalid or has expired", 400));
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null
    }
  });

  sendSuccess(res, 200, "Email verified successfully. You can now login.");
});

// @desc    Resend verification email
// @route   POST /api/auth/resend-verification
// @access  Public
export const resendVerificationEmail = catchAsync(async (req, res, next) => {
  const { email: rawEmail } = req.body;
  const email = rawEmail?.toLowerCase().trim();

  if (!email) return next(new AppError("Email is required", 400));

  const user = await prisma.user.findFirst({ where: { email } });

  if (!user) {
    // For security, don't reveal if user exists or not
    return sendSuccess(res, 200, "If this email exists, a new verification link has been sent.");
  }

  if (user.isVerified) {
    return next(new AppError("Email is already verified. Please login.", 400));
  }

  // Generate new token
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const tokenExpiry = new Date(Date.now() + 3600000); // 1 hour

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationToken: verificationToken,
      emailVerificationExpires: tokenExpiry
    }
  });

  const displayName = user.name || [user.firstName, user.lastName].filter(Boolean).join(" ") || "User";
  await sendVerificationEmail(user.email, displayName, verificationToken);

  sendSuccess(res, 200, "A new verification link has been sent to your email.");
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const loginUser = catchAsync(async (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    console.log("[Auth Debug] Callback received:", {
      err: err?.message || err,
      user: user ? user.email : "none",
      info
    });

    if (err) return next(err);
    if (!user) {
      const errorMessage = info?.message || "Invalid email or password";
      // Return 200 to keep the console clean as requested, but with success: false.
      // The frontend will handle this based on the success flag.
      return res.status(200).json({
        success: false,
        message: errorMessage
      });
    }

    req.logIn(user, (err) => {
      if (err) return next(err);
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.name;

      // Safety check for JWT_SECRET to prevent crash
      const secret = process.env.JWT_SECRET || "default_jwt_secret_fallback_12345";

      // Generate JWT so the protect middleware works cross-origin
      const token = jwt.sign({ id: user.id }, secret, {
        expiresIn: "7d",
      });

      console.log("[Auth Debug] Sending login response for role:", user.role);

      sendSuccess(res, 200, "Logged in successfully.", {
        data: {
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            permissions: user.permissions,
            avatar: user.avatar,
            name: user.name,
            fullName,
            businessType: user.businessType,
          },
        },
      });
    });
  })(req, res, next);
});

// @desc    Logout user
// @route   GET /api/auth/logout
// @access  Private
export const logoutUser = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    sendSuccess(res, 200, "Logged out successfully.");
  });
};

// @desc    Get user profile (Current User)
// @route   GET /api/auth/profile
// @access  Private
export const getUserProfile = (req, res, next) => {
  if (!req.user) return next(new AppError("Not authorized", 401));

  const u = req.user;
  const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.name;

  sendSuccess(res, 200, "Profile fetched.", {
    data: {
      user: {
        id: u.id,
        username: u.username,
        email: u.email,
        avatar: u.avatar,
        name: u.name,
        fullName,
        role: u.role,
        permissions: u.permissions,
        registeredSeller: u.registeredSeller,
        watchlist: u.watchlist,
        businessType: u.businessType,
      },
    },
  });
};
