import "../loadEnv.js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

let databaseUrl = process.env.DATABASE_URL;

if (typeof databaseUrl !== "string" || !databaseUrl.trim()) {
  throw new Error(
    "DATABASE_URL is missing. Add it to ecommerce-backend-postgres/.env or set it in the process environment."
  );
}

// On Supabase Supavisor pooler, port 5432 is Session mode (limited to pool_size: 15).
// Port 6543 is Transaction mode, designed for serverless functions (Vercel) to support high concurrency.
if (databaseUrl.includes(".pooler.supabase.com:5432")) {
  databaseUrl = databaseUrl.replace(".pooler.supabase.com:5432", ".pooler.supabase.com:6543");
}

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  throw new Error("DATABASE_URL is not a valid PostgreSQL connection URL.");
}

if (parsedDatabaseUrl.protocol !== "postgresql:" && parsedDatabaseUrl.protocol !== "postgres:") {
  throw new Error("DATABASE_URL must use the postgresql:// or postgres:// scheme.");
}

if (!parsedDatabaseUrl.password) {
  throw new Error("DATABASE_URL must include a PostgreSQL password.");
}

const globalForDb = globalThis;

const pool =
  globalForDb.pgPrismaPool ||
  new pg.Pool({
    connectionString: databaseUrl,
    min: 0,
    max: process.env.VERCEL ? 3 : 10,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });

if (process.env.NODE_ENV !== "production" || process.env.VERCEL) {
  globalForDb.pgPrismaPool = pool;
}

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
process.on('SIGUSR2', async () => {
  await pool.end();
  process.exit(0);
});
const adapter = new PrismaPg(pool);

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export const connectDB = async () => {
  try {
    await prisma.$connect();
    console.log("✅ PostgreSQL Connected via Prisma");
  } catch (error) {
    console.error(`❌ PostgreSQL Connection Error: ${error.message}`);
    throw error;
  }
};

export default prisma;
