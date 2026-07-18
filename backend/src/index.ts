import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { initDb } from "./initDb";
import { uploadDir } from "./uploads";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import attendanceRoutes from "./routes/attendance";

const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadDir));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/attendance", attendanceRoutes);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

async function start() {
  try {
    await initDb();
  } catch (err) {
    console.error("Database initialization failed:", err);
  }

  // Bind to 0.0.0.0 so the container is reachable on Railway.
  app.listen(port, "0.0.0.0", () => {
    console.log(`Smart Attendance API listening on port ${port}`);
  });
}

start();
