import express from "express";
import { Readable } from "stream";
import fs from "fs";
import os from "os";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import upload from "../middleware/uploadMiddleware.js";
import { cloudinary } from "../config/cloudinary.js";
import { protect, sellerOnly } from "../middleware/auth.js";

// Configure ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

const router = express.Router();

// Protect routes - only logged in users can upload
router.use(protect);

const CHUNK_SIZE = 6 * 1024 * 1024; // 6 MB per chunk
const CLOUDINARY_MAX_SIZE = 100 * 1024 * 1024; // 100 MB limit for free tier

/**
 * Helper: upload a buffer to Cloudinary via upload_stream (for images).
 */
function uploadToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) {
        console.error("Cloudinary upload_stream error:", error);
        return reject(error);
      }
      resolve(result);
    });

    Readable.from(buffer).pipe(uploadStream);
  });
}

/**
 * Helper: Compress video using ffmpeg to stay under the size limit.
 */
function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log("Compressing video to stay under 100MB limit...");
    ffmpeg(inputPath)
      .outputOptions([
        "-vcodec libx264",
        "-crf 28", // Good balance of quality/compression
        "-preset medium",
        "-acodec aac",
        "-b:a 128k",
      ])
      .on("end", () => {
        console.log("Compression finished successfully.");
        resolve();
      })
      .on("error", (err) => {
        console.error("FFmpeg Error:", err);
        reject(err);
      })
      .save(outputPath);
  });
}

/**
 * Helper: upload a video buffer to Cloudinary using true chunked upload.
 * If the video is > 100MB, it will be compressed first to fit Cloudinary Free tier.
 */
function uploadVideoToCloudinary(buffer, options) {
  return new Promise(async (resolve, reject) => {
    const tmpInputFile = path.join(os.tmpdir(), `input_${Date.now()}.tmp`);
    const tmpOutputFile = path.join(os.tmpdir(), `output_${Date.now()}.mp4`);
    let fileToUpload = tmpInputFile;

    try {
      // 1. Write the original buffer to a temp file
      fs.writeFileSync(tmpInputFile, buffer);

      // 2. If video is > 100MB, compress it first
      if (buffer.length > CLOUDINARY_MAX_SIZE) {
        console.log(`Video size (${(buffer.length / 1024 / 1024).toFixed(2)}MB) exceeds 100MB limit.`);
        await compressVideo(tmpInputFile, tmpOutputFile);
        fileToUpload = tmpOutputFile;
      }

      // 3. Perform chunked upload to Cloudinary
      cloudinary.uploader.upload_large(
        fileToUpload,
        { ...options, chunk_size: CHUNK_SIZE },
        (error, result) => {
          // Cleanup temp files
          try { fs.unlinkSync(tmpInputFile); } catch (_) { }
          try { if (fs.existsSync(tmpOutputFile)) fs.unlinkSync(tmpOutputFile); } catch (_) { }

          if (error) {
            console.error("Cloudinary upload_large error:", error);
            return reject(error);
          }
          resolve(result);
        }
      );
    } catch (err) {
      try { if (fs.existsSync(tmpInputFile)) fs.unlinkSync(tmpInputFile); } catch (_) { }
      try { if (fs.existsSync(tmpOutputFile)) fs.unlinkSync(tmpOutputFile); } catch (_) { }
      reject(err);
    }
  });
}

// ─── Upload single image ───────────────────────────────────────────────────
router.post("/upload-image", (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      console.error("Multer error on upload-image:", err.message);
      return res.status(400).json({ status: "error", message: err.message || "File upload error" });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  try {
    console.log(`Uploading image: ${req.file.originalname} (${req.file.size} bytes)`);
    const result = await uploadToCloudinary(req.file.buffer, {
      folder: "ecommerce/images",
      resource_type: "image",
      transformation: [{ width: 1200, height: 1200, crop: "limit", quality: "auto" }],
    });

    res.json({
      status: "success",
      url: result.secure_url,
      public_id: result.public_id,
    });
  } catch (err) {
    console.error("Image Upload Route Error:", err);
    res.status(500).json({ 
      status: "error",
      message: err.message || "Image upload failed",
      details: process.env.NODE_ENV === "development" ? err : undefined
    });
  }
});

// ─── Upload document (PDF/Image) ───────────────────────────────────────────
router.post("/upload-document", (req, res, next) => {
  upload.single("document")(req, res, (err) => {
    if (err) {
      console.error("Multer error on upload-document:", err.message);
      return res.status(400).json({ status: "error", message: err.message || "File upload error" });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No document uploaded" });
  }

  try {
    console.log(`Uploading document: ${req.file.originalname} (${req.file.size} bytes)`);
    const result = await uploadToCloudinary(req.file.buffer, {
      folder: "ecommerce/documents",
      resource_type: "auto",
    });

    res.json({
      status: "success",
      url: result.secure_url,
      public_id: result.public_id,
    });
  } catch (err) {
    console.error("Document Upload Route Error:", err);
    res.status(500).json({ 
      status: "error",
      message: err.message || "Document upload failed",
      details: process.env.NODE_ENV === "development" ? err : undefined
    });
  }
});

// ─── Upload multiple images ────────────────────────────────────────────────
router.post("/upload-images", upload.array("images", 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: "No files uploaded" });
  }

  try {
    console.log(`Uploading ${req.files.length} images`);
    const uploads = await Promise.all(
      req.files.map((file) =>
        uploadToCloudinary(file.buffer, {
          folder: "ecommerce/images",
          resource_type: "image",
          transformation: [{ width: 1200, height: 1200, crop: "limit", quality: "auto" }],
        })
      )
    );

    const results = uploads.map((r) => ({
      url: r.secure_url,
      public_id: r.public_id,
      isPrimary: false,
    }));

    res.json({ status: "success", files: results });
  } catch (err) {
    console.error("Images Upload Route Error:", err);
    res.status(500).json({ 
      status: "error",
      message: err.message || "Images upload failed",
      details: process.env.NODE_ENV === "development" ? err : undefined
    });
  }
});

// ─── Upload single video ───────────────────────────────────────────────────
router.post("/upload-video", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  try {
    const result = await uploadVideoToCloudinary(req.file.buffer, {
      folder: "ecommerce/videos",
      resource_type: "video",
      allowed_formats: ["mp4", "mov", "avi", "mkv", "webm"],
    });

    if (!result || !result.secure_url) {
      throw new Error("Cloudinary upload failed to return a secure URL");
    }

    // Generate a thumbnail URL by replacing the video extension with .jpg
    const thumbnailUrl = result.secure_url.replace(/\.[^/.]+$/, ".jpg");

    res.json({
      status: "success",
      url: result.secure_url,
      public_id: result.public_id,
      thumbnail: thumbnailUrl,
    });
  } catch (err) {
    console.error("Video Upload Error:", err);
    res.status(500).json({ message: err.message || "Video upload failed", status: "error" });
  }
});

export default router;
