import "../loadEnv.js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (typeof databaseUrl !== "string" || !databaseUrl.trim()) {
  throw new Error(
    "DATABASE_URL is missing. Add it to ecommerce-backend-postgres/.env or set it in the process environment."
  );
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

const pool = new pg.Pool({
  connectionString: databaseUrl,
  min: 1,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

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
