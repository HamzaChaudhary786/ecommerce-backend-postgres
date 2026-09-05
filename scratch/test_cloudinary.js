import "../loadEnv.js";
import { cloudinary } from "../config/cloudinary.js";
import fs from "fs";

async function testUpload() {
  console.log("Testing Cloudinary Upload...");
  console.log("Cloud Name:", process.env.CLOUDINARY_CLOUD_NAME);
  
  try {
    // Create a tiny dummy image buffer (1x1 white pixel GIF)
    const buffer = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: "test" },
        (error, result) => {
          if (error) {
            console.error("Upload Error:", error);
            reject(error);
          } else {
            console.log("Upload Success:", result.secure_url);
            resolve(result);
          }
        }
      );
      uploadStream.end(buffer);
    });
  } catch (err) {
    console.error("Test Script Error:", err);
  }
}

testUpload();
