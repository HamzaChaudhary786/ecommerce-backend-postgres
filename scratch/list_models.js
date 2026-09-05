import "../loadEnv.js";
import https from "https";

const apiKey = process.env.GEMINI_API_KEY?.trim();
console.log("Using Key:", apiKey);

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

https.get(url, (res) => {
    let data = "";
    res.on("data", (chunk) => {
        data += chunk;
    });
    res.on("end", () => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.models) {
                console.log("Available Models:");
                parsed.models.forEach(m => {
                    console.log(`- ${m.name} (methods: ${m.supportedGenerationMethods.join(", ")})`);
                });
            } else {
                console.log("No models returned:", parsed);
            }
        } catch (e) {
            console.error("Failed to parse response:", e.message);
            console.log("Raw Response:", data);
        }
    });
}).on("error", (err) => {
    console.error("HTTP error:", err.message);
});
