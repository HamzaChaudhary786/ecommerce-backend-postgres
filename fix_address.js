import pg from 'pg';
const { Client } = pg;

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres.hhjyoxvoheqazmzgjxzt:bSVS8id01Xqr5zaf@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
  });
  
  try {
    await client.connect();
    
    // Check if the address exists
    const checkRes = await client.query('SELECT * FROM "Address" WHERE "userId" = $1', ['32dd77b9-a26d-4aca-961d-9713e203fc19']);
    if (checkRes.rows.length === 0) {
      // Insert the address
      await client.query(`
        INSERT INTO "Address" (id, "userId", city, "postalCode", country, "isDefault", "updatedAt") 
        VALUES (gen_random_uuid(), '32dd77b9-a26d-4aca-961d-9713e203fc19', 'Sahiwal', '56000', 'pakistan', true, NOW())
      `);
      console.log('Address inserted successfully.');
    } else {
      console.log('Address already exists.');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
