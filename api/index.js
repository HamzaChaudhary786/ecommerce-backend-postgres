import { app, connectDB } from "../server.js";
import path from "path";
import fs from "fs";

let databaseConnection;

export default async function handler(req, res) {
  try {
    databaseConnection ??= connectDB();
    await databaseConnection;

    // Handle root / welcome request cleanly on Vercel
    if (
      !req.url ||
      req.url === "/" ||
      req.url === "" ||
      req.url === "/api" ||
      req.url === "/api/" ||
      req.url === "/api/index.js"
    ) {
      if (req.headers.accept?.includes("text/html")) {
        const htmlPath = path.join(process.cwd(), "public", "index.html");
        if (fs.existsSync(htmlPath)) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          return res.status(200).send(fs.readFileSync(htmlPath, "utf-8"));
        }
      }

      return res.status(200).json({
        service: "ShopVault API",
        status: "running",
        endpoints: {
          health: "/api/health",
          listings: "/api/listings",
          categories: "/api/categories",
          stores: "/api/stores",
        },
      });
    }

    return app(req, res);
  } catch (error) {
    databaseConnection = undefined;
    return res.status(503).json({
      status: "error",
      message: "Database connection unavailable",
      details: error.message,
    });
  }
}