import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from the project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const API_URL = process.env.API_URL || 'http://localhost:5000/api';

async function testSuggest() {
    console.log("Starting Auto-Suggest API Test...");

    try {
        // 1. Test with no images (Should fail with 400)
        console.log("\n1. Testing with no images:");
        try {
            await axios.post(`${API_URL}/listings/suggest`, {});
        } catch (err) {
            console.log("✅ Caught expected error:", err.response?.data?.message || err.message);
        }

        // 2. Test fallback logic (Simulated by providing invalid image URLs if possible, or just checking response)
        console.log("\n2. Testing suggest API with sample data:");
        const response = await axios.post(`${API_URL}/listings/suggest`, {
            images: ["https://images.pexels.com/photos/190819/pexels-photo-190819.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1"],
            availableCategories: [{ id: "cat1", name: "Watches" }],
            availableSubcategories: [{ id: "sub1", name: "Luxury Watches", parentId: "cat1" }]
        }, {
            headers: {
                'Content-Type': 'application/json'
                // Note: This might require auth depending on your middleware
            }
        });

        console.log("Status:", response.status);
        console.log("Message:", response.data.message);
        console.log("Data keys:", Object.keys(response.data.data));
        console.log("Is Fallback?", response.data.data.isFallback);
        console.log("Suggested Title:", response.data.data.title);

        if (response.data.data.isFallback) {
            console.log("✅ Fallback logic is working.");
        } else {
            console.log("✨ AI logic is working (or Gemini is online).");
        }

    } catch (error) {
        console.error("❌ Test failed:", error.response?.data || error.message);
    }
}

testSuggest();
