import "./loadEnv.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  console.log("Using API Key:", apiKey ? `${apiKey.substring(0, 7)}...${apiKey.substring(apiKey.length - 4)}` : "None");

  const models = ["gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-1.5-pro", "gemini-2.0-flash", "gemini-2.5-flash"];

  for (const modelName of models) {
    try {
      console.log(`\n--- Testing model: ${modelName} ---`);
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("Say YES if you can respond.");
      console.log(`✅ SUCCESS with ${modelName}! Response:`, result.response.text().trim());
      break;
    } catch (error) {
      const statusCode = error.status || "?";
      console.error(`❌ ${modelName} failed [${statusCode}]:`, error.message.substring(0, 150));
    }
  }

  process.exit(0);
}

main();
