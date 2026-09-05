import crypto from "crypto";

/**
 * Generate EasyPaisa Hash
 * Usually for the checkout flow, it requires a sequence of fields joined by '&'
 */
export const generateEasyPaisaHash = (params, hashKey) => {
  // Sort keys alphabetically if required by EP
  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys
    .map(key => `${key}=${params[key]}`)
    .join("&");
  
  // Create HMAC-SHA256 hash
  return crypto
    .createHmac("sha256", hashKey)
    .update(queryString)
    .digest("hex");
};

/**
 * Generate JazzCash Hash
 * JazzCash requires a specific order of fields usually, or alphabetic
 */
export const generateJazzCashHash = (params, integritySalt) => {
  // 1. Sort the parameters alphabetically by key
  const sortedKeys = Object.keys(params).sort();
  
  // 2. Concatenate the integrity salt and all the values
  let stringToHash = integritySalt;
  for (const key of sortedKeys) {
    if (params[key] !== "" && params[key] !== null) {
      stringToHash += "&" + params[key];
    }
  }
  
  // 3. Create HMAC-SHA256 hash
  return crypto
    .createHmac("sha256", integritySalt)
    .update(stringToHash)
    .digest("hex")
    .toUpperCase();
};
