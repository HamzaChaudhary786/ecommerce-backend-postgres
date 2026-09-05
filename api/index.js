import { app, connectDB } from "../server.js";

let databaseConnection;

export default async function handler(req, res) {
  try {
    databaseConnection ??= connectDB();
    await databaseConnection;
    return app(req, res);
  } catch (error) {
    databaseConnection = undefined;
    return res.status(503).json({
      status: "error",
      message: "Database connection unavailable",
    });
  }
}