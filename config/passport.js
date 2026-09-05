import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import bcrypt from "bcryptjs";
import prisma from "./db.js";

const configurePassport = () => {
  // Local Strategy
  passport.use(
    new LocalStrategy(
      { usernameField: "email" },
      async (email, password, done) => {
        try {
          const rawEmail = email?.trim();
          const lowerEmail = rawEmail?.toLowerCase();
          console.log(`[Passport Debug] Login attempt - Email: "${rawEmail}", Lower: "${lowerEmail}"`);

          // Try to find the user using case-insensitive match on the provided email
          // This should handle both normalized and original mixed-case emails
          let user = await prisma.user.findFirst({
            where: {
              OR: [
                { email: { equals: rawEmail, mode: "insensitive" } },
                { email: { equals: lowerEmail, mode: "insensitive" } }
              ]
            }
          });

          if (!user) {
            console.log(`[Passport Debug] No user found for "${rawEmail}" or "${lowerEmail}"`);
            return done(null, false, { message: "User not found" });
          }
          console.log(`[Passport Debug] Found user: ${user.email} (ID: ${user.id}, Role: ${user.role})`);

          if (user.googleId && !user.password) {
            return done(null, false, {
              message: "Account associated with Google. Please use Google Login.",
            });
          }

          if (user.isSuspended) {
            return done(null, false, {
              message: "Your account has been blocked by admin",
            });
          }

          if (!user.isVerified) {
            return done(null, false, {
              message: "Please verify your email before login.",
            });
          }

          const isMatch = await bcrypt.compare(password, user.password);
          if (!isMatch) {
            return done(null, false, { message: "Invalid password" });
          }

          return done(null, user);
        } catch (error) {
          console.error("[Passport Debug] Error in LocalStrategy:", error);
          return done(error);
        }
      }
    )
  );

  // Google Strategy
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
        passReqToCallback: true,
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          // Extract role from state parameter
          let role = "buyer";
          if (req.query.state) {
            try {
              const state = JSON.parse(req.query.state);
              if (state.role) role = state.role;
            } catch (e) {
              console.error("Error parsing OAuth state:", e);
            }
          }

          // Check if user already exists by googleId
          let user = await prisma.user.findUnique({
            where: { googleId: profile.id },
          });

          if (user) {
            if (user.isSuspended) {
              return done(null, false, {
                message: "Your account has been blocked by admin",
              });
            }
            return done(null, user);
          }

          // If not, see if email exists (link account)
          user = await prisma.user.findUnique({
            where: { email: profile.emails[0].value },
          });

          if (user) {
            if (user.isSuspended) {
              return done(null, false, {
                message: "Your account has been blocked by admin",
              });
            }
            user = await prisma.user.update({
              where: { id: user.id },
              data: {
                googleId: profile.id,
                avatar: profile.photos[0].value,
              },
            });
            return done(null, user);
          }

          // Prevent new Admin account creation via Google OAuth
          if (role === "admin") {
            return done(null, false, { message: "Admin account not found" });
          }

          // Create new user with targeted role
          user = await prisma.user.create({
            data: {
              name: profile.displayName,
              email: profile.emails[0].value,
              googleId: profile.id,
              avatar: profile.photos[0].value,
              role: role,
              isVerified: true, // Google email is already verified
            },
          });

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { id } });
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });
};

export default configurePassport;
