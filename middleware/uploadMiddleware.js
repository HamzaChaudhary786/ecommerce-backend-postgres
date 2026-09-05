import multer from "multer";

// Use memory storage — files are buffered and then piped to Cloudinary manually.
// This avoids the 413 error that multer-storage-cloudinary causes for large videos.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB — increased to handle live camera captures & large images
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image") ||
      file.mimetype.startsWith("video") ||
      file.mimetype === "application/pdf"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only images, videos, and PDFs are allowed!"), false);
    }
  },
});

export default upload;
