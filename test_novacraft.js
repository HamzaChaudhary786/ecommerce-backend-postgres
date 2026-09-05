import pg from 'pg';
const { Client } = pg;

async function check() {
  const client = new Client({
    connectionString: "postgresql://postgres.hhjyoxvoheqazmzgjxzt:bSVS8id01Xqr5zaf@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres" 
  });
  
  try {
    await client.connect();
    
    const storeRes = await client.query('SELECT * FROM "SellerStore" WHERE "storeName" = $1', ['NovaCraft Market']);
    const store = storeRes.rows[0];
    console.log("NovaCraft Store:", JSON.stringify(store, null, 2));

    if (store) {
      const userRes = await client.query('SELECT * FROM "User" WHERE "id" = $1', [store.sellerId]);
      console.log("NovaCraft Seller (User):", JSON.stringify(userRes.rows[0], null, 2));

      const addrRes = await client.query('SELECT * FROM "Address" WHERE "userId" = $1', [store.sellerId]);
      console.log("NovaCraft Addresses:", JSON.stringify(addrRes.rows, null, 2));
    }
    
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

check();
