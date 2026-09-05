import pg from 'pg';
const { Client } = pg;

async function check() {
  const client = new Client({
    connectionString: "postgresql://postgres.hhjyoxvoheqazmzgjxzt:bSVS8id01Xqr5zaf@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
  });

  try {
    await client.connect();

    const storeRes = await client.query('SELECT "verificationData" FROM "SellerStore" WHERE "sellerId" = $1', ['32dd77b9-a26d-4aca-961d-9713e203fc19']);
    console.log("NovaCraft VerificationData:", JSON.stringify(storeRes.rows[0]));

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

check();



