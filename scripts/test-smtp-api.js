import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_URL = "http://localhost:5000/api/admin/test-smtp";
const COOKIE = ""; // You can pass your session cookie here if testing from CLI

async function testSmtp() {
    console.log("🧪 Testing SMTP Endpoint...");
    try {
        const response = await axios.post(API_URL, {
            email: "ayeshakhadam2@gmail.com"
        });
        console.log("Response:", JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("Error:", error.response?.data || error.message);
        console.log("\nNote: This endpoint requires Admin authentication. Make sure the server is running.");
    }
}

testSmtp();
