const multer = require("multer");
const path = require("path");

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const configuredMax = Number.parseInt(process.env.MAX_FILE_SIZE || "5242880", 10);
const maxFileSize = Number.isSafeInteger(configuredMax) && configuredMax > 0 ? configuredMax : 5242880;

const createImageUpload = () => multer({
  dest: path.join(__dirname, "..", "uploads", "tmp"),
  limits: { fileSize: maxFileSize, files: 1, fields: 20 },
  fileFilter: (_req, file, callback) => {
    if (!allowedImageTypes.has(String(file.mimetype || "").toLowerCase())) {
      return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
    }
    return callback(null, true);
  },
});

module.exports = { createImageUpload };
