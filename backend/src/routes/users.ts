import { Router } from "express";
import { pool } from "../db";
import { AuthedRequest, requireAuth } from "../middleware/auth";

const router = Router();

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, role, student_id, department, created_at FROM users WHERE id = $1",
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const totalDays = await pool.query(
      "SELECT COUNT(*) FROM attendance WHERE user_id = $1 AND status = 'Present'",
      [req.userId]
    );
    const allDays = await pool.query("SELECT COUNT(*) FROM attendance WHERE user_id = $1", [
      req.userId,
    ]);

    const present = Number(totalDays.rows[0].count);
    const total = Number(allDays.rows[0].count);
    const attendancePercent = total > 0 ? Math.round((present / total) * 100) : 0;

    res.json({ ...result.rows[0], attendancePercent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

export default router;
