-- Smart Attendance App — PostgreSQL schema

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(120) NOT NULL,
  email          VARCHAR(160) NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           VARCHAR(20) NOT NULL DEFAULT 'student', -- student | employee
  student_id     VARCHAR(40),
  department     VARCHAR(80),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS allowed_locations (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  radius_m    INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS attendance (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         DATE NOT NULL DEFAULT CURRENT_DATE,
  marked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  image_path   TEXT NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'Present', -- Present | Absent
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, date);

-- Seed the default allowed location only when the table is empty, so that
-- re-running this script on every startup doesn't create duplicate rows.
INSERT INTO allowed_locations (name, latitude, longitude, radius_m)
SELECT 'Dublin Business School', 53.3389, -6.2658, 150
WHERE NOT EXISTS (SELECT 1 FROM allowed_locations);
