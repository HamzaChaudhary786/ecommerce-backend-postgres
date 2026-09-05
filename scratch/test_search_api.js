import * as dotenv from 'dotenv';
import fs from 'fs';
import { GoogleGenerativeAI } from "@google/generative-ai";

const envConfig = dotenv.parse(fs.readFileSync('.env'))
for (const k in envConfig) { process.env[k] = envConfig[k]; }

async function run() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  console.log("Using API Key starting with:", apiKey ? apiKey.substring(0, 10) + "..." : "undefined");

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { responseMimeType: "application/json" } });

    // Dummy tiny 1x1 black pixel GIF image base64
    const base64Data = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const mimeType = "image/gif";

    console.log("Sending model request...");
    const result = await model.generateContent([
      `Identify the MAIN product in the image. Return ONLY a JSON object:
      {
        "object": "single core noun representing the product, e.g. 'bangle', 'handbag', 'lipstick'",
        "search_phrase": "a descriptive, detailed search phrase for the product, e.g. 'Traditional Indian Gold Studded Bangles'",
        "category": "the single best category name chosen from this exact list: mobile, Furniture, Home Decor, Makeup, laptop, electronics, Shirts, Shoes, Dresses, Handbags, Boys Clothing, Girls Clothing, Skincare, Gym Equipment, Sports Shoes, Kids Fashion, Women Fashion, Accessories, Beauty & Personal Care, food, Sports & Fitness, Home & Living, Pet Supplies, Automotive, Books & Stationery, Toys & Games, Health & Wellness, Men Fashion",
        "core_synonyms": ["list of 3-5 closely related synonyms, e.g. ['bangles', 'bangle', 'bracelet', 'jewelry', 'ornament']"]
      }`,
      { inlineData: { data: base64Data, mimeType } }
    ]);

    const responseText = result.response.text();
    console.log("Response text received:", responseText);

    const parsed = JSON.parse(responseText.match(/\{[\s\S]*\}/)?.[0]);
    console.log("Successfully parsed JSON:", parsed);
    console.log("TEST SUCCESSFUL!");
  } catch (err) {
    console.error("TEST FAILED WITH ERROR:", err);
  }
}




run();
