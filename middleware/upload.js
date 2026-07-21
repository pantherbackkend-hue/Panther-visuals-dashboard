import multer from "multer";
import { isCloudinaryConfigured, menuImageStorage } from "../config/cloudinary.js";

const imageFileFilter = (req, file, cb) => {
  if (file.mimetype && file.mimetype.startsWith("image/")) {
    cb(null, true);
    return;
  }
  cb(new Error("Only image files are allowed."));
};

export const uploadMenuImage = multer({
  storage: menuImageStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});
