# Smart Attendance

Hybrid mobile app for marking attendance via GPS geofence check + selfie verification.

- `backend/` — Node.js + Express + PostgreSQL REST API
- `frontend/` — Ionic React + Capacitor mobile app (Camera + Geolocation plugins)

## Backend setup

```bash
cd backend
cp .env.example .env      # edit DATABASE_URL and JWT_SECRET
createdb smart_attendance
npm install
npm run db:init           # applies schema.sql (creates tables + a default allowed_locations row)
npm run dev                # http://localhost:4000
```

Edit the seeded row in `allowed_locations` (or insert your own) to match your campus/office
coordinates and radius — this is what `/api/attendance/mark` checks against.

## Deploy backend on Railway

The backend is Railway-ready (`backend/railway.json`). Steps:

1. Push this repo to GitHub, then in Railway create a **New Project → Deploy from GitHub repo**.
2. In the service **Settings**, set **Root Directory** to `backend` (the repo has both `backend/` and `frontend/`).
3. Add a **PostgreSQL** database to the project (New → Database → PostgreSQL). Railway exposes
   `DATABASE_URL` automatically.
4. Add these service **Variables**:
   - `DATABASE_URL` = `${{ Postgres.DATABASE_URL }}`
   - `JWT_SECRET` = a long random string
   - `PGSSL` = `false` if you reference the private `DATABASE_URL` (default), or `true` if you use
     the public proxy URL. (Leave unset to auto-detect.)
   - *(optional)* `UPLOAD_DIR` = `/data/uploads` and attach a **Volume** mounted at `/data` so
     uploaded selfies persist across redeploys.
5. Deploy. Railway builds with `npm ci && npm run build` and starts with `npm run start`.
   The schema in `schema.sql` is applied automatically on startup (idempotent), so no manual
   `db:init` is needed. Health check: `GET /api/health`.
6. Generate a public domain under **Settings → Networking → Generate Domain**, then point the
   frontend's `VITE_API_URL` at `https://<your-app>.up.railway.app`.

> Note: `PORT` is injected by Railway — don't hardcode it. The server binds to `0.0.0.0`.

## Frontend setup

```bash
cd frontend
cp .env.example .env      # VITE_API_URL, point at your backend
npm install
npm run dev                 # http://localhost:5173, browser dev/testing
```

### Running on an Android device/emulator (Camera + Geolocation need a real device or emulator — browser geolocation/camera prompts work for quick testing but Capacitor native plugins need a build)

```bash
npm run build
npx cap add android
npm run cap:sync
npm run cap:android         # opens Android Studio
```

Grant Camera and Location permissions when prompted on-device.

## Notes

- `npm audit` on the frontend reports two dev-only advisories (Vite's dev-server esbuild, and
  `tar` inside `@capacitor/cli`). Both are build/CLI tooling, not code shipped in the app bundle;
  fixing them requires a breaking major upgrade of Vite/Capacitor CLI, so they're left as-is.
- Selfies are stored on disk under `backend/uploads/` and served at `/uploads/<filename>`;
  swap for S3/Cloud Storage before shipping to production.
- "Today" for attendance (`CURRENT_DATE` in `/api/attendance/today` and `/mark`'s upsert) is the
  **database server's** local date, not the user's. If the DB runs in a different timezone than
  users (e.g. UTC server, UTC+5 users), a user marking attendance late at night can get recorded
  under what the server still considers "yesterday," and the dashboard will show "not marked yet"
  until the server's date rolls over. Fix by having the client send its own local date (or by
  pinning the DB session timezone to the deployment's target timezone) before shipping.
- On Android, Capacitor's `androidScheme` is set to `"http"` (see `capacitor.config.ts`) so the
  WebView's origin matches a plain-HTTP local dev backend and avoids mixed-content blocks. Switch
  it back to `"https"` once the backend is served over TLS.
