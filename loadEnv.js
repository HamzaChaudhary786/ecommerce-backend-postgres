import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, ".env");
console.log(`[EnvLoader] Loading env from: ${envPath}`);
dotenv.config({ path: envPath, override: true });
