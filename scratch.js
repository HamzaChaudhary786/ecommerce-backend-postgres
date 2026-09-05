import express from "express";

const app = express();
const router = express.Router();

const protect = (req, res, next) => {
  console.log("protect hit");
  next();
};

const sellerOnly = (req, res, next) => {
  console.log("sellerOnly hit");
  next();
};

// Authenticated & Seller only (static routes first)
router.use("/seller", protect, sellerOnly);
router.get("/seller/my-store", (req, res) => res.send("GET my-store"));
router.patch("/seller/my-store", (req, res) => res.send("PATCH my-store"));

app.use("/api/stores", router);

app.all("*", (req, res) => res.status(404).send("404 Not Found"));

app.listen(3001, async () => {
  console.log("Server listening on 3001");
  
  let res = await fetch("http://localhost:3001/api/stores/seller/my-store");
  console.log("GET", res.status, await res.text());

  res = await fetch("http://localhost:3001/api/stores/seller/my-store", { method: "PATCH" });
  console.log("PATCH", res.status, await res.text());

  process.exit(0);
});
