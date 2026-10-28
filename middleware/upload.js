const multer = require("multer");
const path = require("path");
const fs = require("fs");

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const configuredMax = Number.parseInt(process.env.MAX_FILE_SIZE || "5242880", 10);
const maxFileSize = Number.isSafeInteger(configuredMax) && configuredMax > 0 ? configuredMax : 5242880;

// Detect the real image type from the file signature (the client-declared
// mimetype and filename cannot be trusted). Returns a safe extension or null.
const detectImageExtension = (buf) => {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return ".png";
  if (buf.toString("ascii", 0, 4) === "GIF8") return ".gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return ".webp";
  return null;
};

// Runs after multer: rejects non-images and normalises the filename so handlers
// that derive the stored extension from originalname always get an image extension.
const verifyUploadedImage = (req, res, next) => {
  if (!req.file) return next();
  let header;
  try {
    const fd = fs.openSync(req.file.path, "r");
    header = Buffer.alloc(12);
    fs.readSync(fd, header, 0, 12, 0);
    fs.closeSync(fd);
  } catch (_e) {
    header = null;
  }
  const ext = detectImageExtension(header);
  if (!ext) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ success: false, message: "Only JPEG, PNG, GIF or WebP images are allowed" });
  }
  req.file.originalname = `image${ext}`;
  return next();
};

const createImageUpload = () => {
  const uploader = multer({
    dest: path.join(__dirname, "..", "uploads", "tmp"),
    limits: { fileSize: maxFileSize, files: 1, fields: 20 },
    fileFilter: (_req, file, callback) => {
      if (!allowedImageTypes.has(String(file.mimetype || "").toLowerCase())) {
        return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
      }
      return callback(null, true);
    },
  });
  return {
    single: (field) => [uploader.single(field), verifyUploadedImage],
  };
};

module.exports = { createImageUpload, detectImageExtension, maxFileSize };
