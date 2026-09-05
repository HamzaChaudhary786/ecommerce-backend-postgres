import { app, connectDB } from "../server.js";

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