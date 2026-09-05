import pg from "pg";
import "dotenv/config";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const res = await pool.query('SELECT email, role, "isSuspended" FROM "User"');
    console.log("USERS_START");
    console.log(JSON.stringify(res.rows, null, 2));
    console.log("USERS_END");
  } catch (err) {
    console.error("Query Error:", err);
  } finally {
    await pool.end();
  }
}

main();
