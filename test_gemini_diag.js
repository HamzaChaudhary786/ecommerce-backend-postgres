import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

async function testGemini() {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    console.log("API Key found:", apiKey ? "Yes (length: " + apiKey.length + ")" : "No");

    if (!apiKey) {
        console.error("No API key found in .env");
        return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const models = ["gemini-1.5-flash", "gemini-2.0-flash-exp", "gemini-1.5-pro", "gemini-2.0-flash"];

    for (const modelName of models) {
        try {
            console.log(`\nTesting model: ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Hello, respond with 'OK' if you see this.");
            console.log(`Success with ${modelName}:`, result.response.text().trim());
        } catch (err) {
            console.error(`Error with ${modelName}:`, err.message);
        }
    }
}

testGemini();
