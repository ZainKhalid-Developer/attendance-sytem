import fs from "fs";
import path from "path";

// Where selfies are stored. On Railway the local filesystem is ephemeral, so
// point UPLOAD_DIR at a mounted Volume (e.g. /data/uploads) to persist files.
// For production you should swap this for S3/Cloud Storage.
export const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "..", "uploads");

fs.mkdirSync(uploadDir, { recursive: true });
