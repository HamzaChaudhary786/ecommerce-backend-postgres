import "../loadEnv.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  console.log("Using API Key:", apiKey ? `${apiKey.substring(0, 7)}...${apiKey.substring(apiKey.length - 4)}` : "None");

  const models = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash"
  ];

  for (const modelName of models) {
    try {
      console.log(`\n--- Testing vision model: ${modelName} ---`);
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      
      // Simple base64 pixel as a minimal image part
      const dummyImage = {
        inlineData: {
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          mimeType: "image/png"
        }
      };

      const result = await model.generateContent([
        "Describe what color you see in the image briefly.",
        dummyImage
      ]);
      console.log(`✅ SUCCESS with ${modelName}! Response:`, result.response.text().trim());
    } catch (error) {
      const statusCode = error.status || "?";
      console.error(`❌ ${modelName} failed [${statusCode}]:`, error.message.substring(0, 150));
    }
  }

  process.exit(0);
}

main();
