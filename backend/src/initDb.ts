import fs from "fs";
import path from "path";
import { pool } from "./db";

// Applies schema.sql on startup. All statements are idempotent
// (CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING), so this is safe
// to run on every boot and removes the need for `psql` on the host.
export async function initDb(): Promise<void> {
  const candidates = [
    path.join(__dirname, "..", "schema.sql"),
    path.join(process.cwd(), "schema.sql"),
  ];
  const schemaPath = candidates.find((p) => fs.existsSync(p));

  if (!schemaPath) {
    console.warn("schema.sql not found; skipping automatic DB init.");
    return;
  }

  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  console.log(`Applied database schema from ${schemaPath}`);
}
