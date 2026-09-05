import prisma from './config/db.js';

async function test() {
  try {
    const where = {};
    where.status = "active";
    
    // verifiedSupplier
    where.seller = { ...where.seller, store: { isVerified: true } };
    
    // businessType
    const typeList = ['MANUFACTURER'];
    where.seller = { ...where.seller, businessType: { in: typeList } };
    
    // country
    const countryList = ['China'];
    where.seller = {
      ...where.seller,
      addresses: { some: { country: { in: countryList } } }
    };
    
    // moq
    where.AND = [{ OR: [{ moqQuantity: { lte: 10 } }, { moqQuantity: null }] }];
    
    // productTypes
    where.AND.push({ OR: [{ allowDirectOrder: true }] });
    
    console.log(JSON.stringify(where, null, 2));

    const res = await prisma.listing.findMany({ where, take: 2 });
    console.log(res);
  } catch (err) {
    console.error(err);
  }
}

test();
