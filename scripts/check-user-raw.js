import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
dotenv.config();

async function main() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();
        const updateRes = await client.query("UPDATE \"User\" SET \"isVerified\" = true WHERE email = $1", ['ayeshakhadam2@gmail.com']);
        console.log(`Updated ${updateRes.rowCount} user(s).`);
        const res = await client.query("SELECT email, role, \"isVerified\", \"isSuspended\", \"googleId\" FROM \"User\" WHERE email = $1", ['ayeshakhadam2@gmail.com']);
        console.log(JSON.stringify(res.rows[0], null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

main();
