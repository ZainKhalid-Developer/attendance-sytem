import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { pool } from "../db";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { isWithinRadius } from "../utils/geofence";
import { uploadDir } from "../uploads";

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const authedReq = req as AuthedRequest;
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `attendance_${authedReq.userId}_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/attendance/today — today's status for the logged-in user
router.get("/today", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM attendance WHERE user_id = $1 AND date = CURRENT_DATE",
      [req.userId]
    );
    res.json({ marked: result.rows.length > 0, record: result.rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load today's attendance" });
  }
});

// GET /api/attendance/history — full attendance history for the logged-in user
router.get("/history", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const result = await pool.query(
      "SELECT date, status, marked_at FROM attendance WHERE user_id = $1 ORDER BY date DESC",
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load attendance history" });
  }
});

// POST /api/attendance/mark — geolocation check + selfie upload
router.post("/mark", requireAuth, upload.single("image"), async (req: AuthedRequest, res) => {
  const { latitude, longitude } = req.body;
  const lat = parseFloat(latitude);
  const lon = parseFloat(longitude);

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: "Valid latitude and longitude are required" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "A selfie image is required" });
  }

  try {
    const locations = await pool.query<{
      latitude: number;
      longitude: number;
      radius_m: number;
    }>("SELECT * FROM allowed_locations");
    const withinAny = locations.rows.some((loc) =>
      isWithinRadius(lat, lon, loc.latitude, loc.longitude, loc.radius_m)
    );

    if (!withinAny) {
      fs.unlink(req.file.path, () => {});
      return res.status(403).json({
        error: "Attendance Failed: You are not within the authorized location.",
      });
    }

    const result = await pool.query(
      `INSERT INTO attendance (user_id, latitude, longitude, image_path, status)
       VALUES ($1, $2, $3, $4, 'Present')
       ON CONFLICT (user_id, date)
       DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
                     image_path = EXCLUDED.image_path, marked_at = now()
       RETURNING *`,
      [req.userId, lat, lon, req.file.filename]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark attendance" });
  }
});

export default router;
