# Smart Attendance — Complete Technical Documentation

A hybrid mobile application for marking attendance using a **GPS geofence check** combined with a **selfie verification**. A user can only mark themselves "Present" if they are physically inside an authorized location radius **and** provide a camera selfie at that moment.

This document explains, in complete detail, every module used, how each one works, the end-to-end flow of the app, the frameworks, the database, the API, deployment, and the security model.

---

## 1. High-Level Overview

The project is a **monorepo** with two independent applications:

| Part | Location | What it is | Runs on |
|------|----------|------------|---------|
| **Backend** | `backend/` | REST API server | Node.js (Railway) |
| **Frontend** | `frontend/` | Mobile / web client | Ionic React + Capacitor (Android + PWA/Vercel) |

The frontend talks to the backend exclusively over HTTP(S) JSON + one multipart upload endpoint (for the selfie). Authentication is stateless using **JWT** tokens stored in the browser/device `localStorage`.

```
┌─────────────────────────────┐         HTTPS / JSON + JWT         ┌──────────────────────────────┐
│        FRONTEND             │  ───────────────────────────────► │          BACKEND              │
│  Ionic React + Capacitor    │                                    │   Node.js + Express           │
│  - Camera plugin (selfie)   │  ◄─────────────────────────────── │   - Auth (bcrypt + JWT)       │
│  - Geolocation plugin (GPS) │        JSON responses              │   - Geofence check (haversine)│
│  - React Router (tabs)      │                                    │   - Multer file uploads       │
└─────────────────────────────┘                                    └───────────────┬──────────────┘
                                                                                    │ SQL (pg Pool)
                                                                                    ▼
                                                                        ┌───────────────────────┐
                                                                        │      PostgreSQL       │
                                                                        │  users / attendance / │
                                                                        │  allowed_locations    │
                                                                        └───────────────────────┘
```

---

## 2. Technology Stack (Frameworks & Languages)

### Language
- **TypeScript** everywhere (both backend and frontend), compiled with `tsc`.

### Backend framework & runtime
- **Node.js** runtime, **CommonJS** modules (`"type": "commonjs"`).
- **Express 4** — the HTTP web framework that defines the routes and middleware.

### Frontend framework
- **React 18** — the UI library.
- **Ionic React 8** — the mobile UI component framework (provides `IonPage`, `IonButton`, tabs, cards, etc. — native-looking mobile components).
- **Capacitor 6** — the native bridge that wraps the web app into a native **Android** app and exposes native device APIs (Camera, Geolocation).
- **Vite 5** — the build tool / dev server for the frontend.

### Database
- **PostgreSQL** accessed through the **`pg`** driver (connection pooling).

---

## 3. Backend — Detailed Breakdown

### 3.1 Backend dependencies (`backend/package.json`) and what each does

| Module | Purpose in this app |
|--------|---------------------|
| **express** | Web server & routing framework; defines all `/api/*` endpoints. |
| **pg** | PostgreSQL client. A single connection **Pool** is shared across the app. |
| **bcryptjs** | Hashes user passwords (salted, cost factor 10) and verifies them on login. |
| **jsonwebtoken** | Signs and verifies **JWT** auth tokens (7-day expiry). |
| **multer** | Handles `multipart/form-data` uploads — receives and stores the selfie image on disk. |
| **cors** | Enables Cross-Origin requests so the browser/mobile client on a different origin can call the API. |
| **dotenv** | Loads environment variables from `.env` (imported as `dotenv/config`). |

Dev dependencies: **typescript**, **ts-node-dev** (hot-reloading dev server), and `@types/*` type definitions.

### 3.2 Scripts (`backend/package.json`)
- `dev` → `ts-node-dev --respawn --transpile-only src/index.ts` — local dev with auto-restart.
- `build` → `tsc -p tsconfig.json` — compiles `src/` to `dist/`.
- `start` → `node dist/index.js` — production start (used by Railway).
- `db:init` → applies `schema.sql` to the DB via `psql` (only needed for manual local setup).

### 3.3 File-by-file

#### `src/index.ts` — application entry point
This is the server bootstrap. It:
1. Loads env vars (`import "dotenv/config"`).
2. Creates the Express app.
3. Registers global middleware:
   - `cors()` — allow cross-origin calls.
   - `express.json()` — parse JSON request bodies.
   - `express.static(uploadDir)` mounted at `/uploads` — serve uploaded selfies as static files.
4. Mounts the three route modules:
   - `/api/auth` → `routes/auth.ts`
   - `/api/users` → `routes/users.ts`
   - `/api/attendance` → `routes/attendance.ts`
5. Exposes a health check: `GET /api/health` → `{ ok: true }` (used by Railway's health check).
6. On startup calls `initDb()` (applies the schema), then `app.listen(port, "0.0.0.0")`. It binds to `0.0.0.0` and uses `process.env.PORT` (injected by Railway) or `4000` locally.

```22:37:backend/src/index.ts
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
```

#### `src/db.ts` — database connection
Creates and exports a single `pg` **Pool** using `DATABASE_URL`. It includes smart **SSL auto-detection**:
- SSL is enabled if `PGSSL=true`, **or** if the connection string is clearly a public host (not `localhost`, `127.0.0.1`, or `*.railway.internal`) and `PGSSL` isn't explicitly `false`.
- This lets the same code run locally (no SSL) and on Railway's public proxy (SSL required) without changes.

#### `src/initDb.ts` — automatic schema setup
On boot it looks for `schema.sql` (next to `dist/` or in the CWD), reads it, and runs it against the DB. Because every statement in the schema is **idempotent** (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`), it is safe to run on every startup — no manual migration step is needed in production.

#### `src/uploads.ts` — upload directory resolution
Determines where selfies are saved:
- Uses `UPLOAD_DIR` env var if set (recommended: a mounted Railway Volume like `/data/uploads` so files survive redeploys).
- Otherwise defaults to `backend/uploads/`.
- Creates the directory (`fs.mkdirSync(..., { recursive: true })`) on load.

> Note: local disk storage is fine for development but ephemeral in the cloud. For production the recommendation is to swap to S3/Cloud Storage.

#### `src/middleware/auth.ts` — JWT authentication guard
Exports `requireAuth`, an Express middleware:
1. Reads the `Authorization: Bearer <token>` header.
2. If missing → `401 Missing authorization token`.
3. Verifies the JWT with `JWT_SECRET`. On success it attaches `req.userId` (from the token payload) and calls `next()`.
4. On failure → `401 Invalid or expired token`.

It also defines the `AuthedRequest` interface (an Express `Request` with an optional `userId`), used by all protected routes.

#### `src/utils/geofence.ts` — location math
The core of the "smart" attendance logic. Pure functions, no dependencies:
- `distanceMeters(lat1, lon1, lat2, lon2)` — computes the great-circle distance between two GPS coordinates using the **Haversine formula** (Earth radius = 6,371,000 m).
- `isWithinRadius(userLat, userLon, centerLat, centerLon, radiusM)` — returns `true` if the user is within `radiusM` meters of the authorized center point.

```7:21:backend/src/utils/geofence.ts
/** Great-circle distance between two lat/lng points, in meters (haversine formula). */
export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}
```

#### `src/routes/auth.ts` — registration & login (public)
- **`POST /api/auth/register`**
  - Body: `{ name, email, password, role?, studentId?, department? }`.
  - Validates required fields; rejects duplicate email (`409`).
  - Hashes the password with `bcrypt.hash(password, 10)`.
  - Inserts the user (`role` defaults to `student`).
  - Returns a signed **JWT** (`{ userId }`, 7-day expiry) + the user object.
- **`POST /api/auth/login`**
  - Body: `{ email, password }`.
  - Looks up the user, compares the password with `bcrypt.compare`.
  - On success returns a JWT + user object (with `password_hash` stripped out).
  - Generic `401 Invalid email or password` on any auth failure (no user enumeration).

#### `src/routes/users.ts` — profile (protected)
- **`GET /api/users/me`** (requires `requireAuth`)
  - Returns the logged-in user's profile fields.
  - Computes an **attendance percentage**: `present days / total recorded days * 100` (rounded), by counting rows in `attendance`.

#### `src/routes/attendance.ts` — the heart of the app (protected)
Configures **Multer** disk storage: files are saved into `uploadDir` with a deterministic name `attendance_<userId>_<timestamp>.<ext>`, limited to **5 MB**.

Endpoints (all require `requireAuth`):
- **`GET /api/attendance/today`** — returns whether the user has already marked attendance for the DB's `CURRENT_DATE`, plus the record if present.
- **`GET /api/attendance/history`** — returns all of the user's attendance rows (`date`, `status`, `marked_at`), newest first.
- **`POST /api/attendance/mark`** — the main action. `upload.single("image")` parses the selfie. Then:
  1. Parses `latitude`/`longitude` from the form body; `400` if invalid.
  2. `400` if no selfie file was uploaded.
  3. Loads **all** rows from `allowed_locations` and checks if the user is within *any* of them using `isWithinRadius`.
  4. If **not** within any location → deletes the just-uploaded file and returns `403 "Attendance Failed: You are not within the authorized location."`.
  5. If within → **upserts** the attendance record: `INSERT ... ON CONFLICT (user_id, date) DO UPDATE`. This guarantees **one record per user per day** — re-marking updates the existing row (coordinates, image, `marked_at`) instead of creating a duplicate.
  6. Returns the saved record (`201`).

```80:90:backend/src/routes/attendance.ts
    const result = await pool.query(
      `INSERT INTO attendance (user_id, latitude, longitude, image_path, status)
       VALUES ($1, $2, $3, $4, 'Present')
       ON CONFLICT (user_id, date)
       DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
                     image_path = EXCLUDED.image_path, marked_at = now()
       RETURNING *`,
      [req.userId, lat, lon, req.file.filename]
    );
```

---

## 4. Database — PostgreSQL Schema (`backend/schema.sql`)

Three tables.

### `users`
| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `name` | VARCHAR(120) | required |
| `email` | VARCHAR(160) | **UNIQUE**, required |
| `password_hash` | TEXT | bcrypt hash |
| `role` | VARCHAR(20) | default `student` (`student` \| `employee`) |
| `student_id` | VARCHAR(40) | optional |
| `department` | VARCHAR(80) | optional |
| `created_at` | TIMESTAMPTZ | default `now()` |

### `allowed_locations` (the geofences)
| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `name` | VARCHAR(120) | e.g. "University Campus" |
| `latitude` | DOUBLE PRECISION | center point |
| `longitude` | DOUBLE PRECISION | center point |
| `radius_m` | INTEGER | default `100` meters |

Seeded with one default row (`University Campus`, `31.5204, 74.3587`, radius `100`). **You must edit this row** to match your real campus/office coordinates — this is what `/api/attendance/mark` checks against.

### `attendance`
| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `user_id` | INTEGER FK → `users(id)` | `ON DELETE CASCADE` |
| `date` | DATE | default `CURRENT_DATE` |
| `marked_at` | TIMESTAMPTZ | default `now()` |
| `latitude` | DOUBLE PRECISION | where they marked |
| `longitude` | DOUBLE PRECISION | where they marked |
| `image_path` | TEXT | selfie filename |
| `status` | VARCHAR(20) | default `Present` |
| — | **UNIQUE (user_id, date)** | enforces one mark per user per day |

Index: `idx_attendance_user_date` on `(user_id, date)` for fast lookups.

> **Timezone caveat:** "Today" uses the **database server's** local date (`CURRENT_DATE`). If the DB is in UTC but users are in another timezone, a late-night mark can land under the "wrong" day. See README for the fix (send client date / pin session timezone).

---

## 5. Frontend — Detailed Breakdown

### 5.1 Frontend dependencies (`frontend/package.json`) and what each does

| Module | Purpose |
|--------|---------|
| **react**, **react-dom** | Core UI library. |
| **@ionic/react** | Mobile UI components (pages, buttons, tabs, cards, lists, inputs, spinner, etc.). |
| **@ionic/react-router** | Ionic's integration with React Router (page transitions, router outlet). |
| **react-router / react-router-dom** (v5) | Client-side routing. |
| **@capacitor/core**, **@capacitor/android** | Capacitor runtime + Android platform target. |
| **@capacitor/camera** | Native camera access to capture the verification selfie. |
| **@capacitor/geolocation** | Native GPS access to get the user's coordinates. |
| **@ionic/pwa-elements** | Provides web fallbacks so the Camera plugin works in a browser/PWA (not just native). |
| **ionicons** | Icon set used in the tab bar. |

Dev: **vite**, **@vitejs/plugin-react**, **typescript**, **@capacitor/cli**, `@types/*`.

### 5.2 Scripts
- `dev` → `vite` (browser dev at `http://localhost:5173`).
- `build` → `tsc -b && vite build` (outputs to `dist/`).
- `preview` → serve the production build.
- `cap:sync` → `cap sync` (copies web build into the native Android project).
- `cap:android` → `cap open android` (opens Android Studio).

### 5.3 File-by-file

#### `src/main.tsx` — entry point
- Mounts `<App />` into `#root`.
- Imports all Ionic core CSS + the custom theme.
- Calls `defineCustomElements(window)` from `@ionic/pwa-elements` so the Camera plugin has web UI when running in a browser/PWA (e.g., on Vercel).

#### `src/App.tsx` — routing & shell
- Calls `setupIonicReact()`.
- Wraps everything in `IonApp` → `AuthProvider` → `IonReactRouter`.
- **`AppRoutes`**: public routes `/login`, `/register`; a `ProtectedRoute` for `/app`; and `/` which redirects to `/app/dashboard` if logged in, else `/login`.
- **`AuthedTabs`**: the authenticated shell — an `IonTabs` bottom tab bar with four tabs:
  - **Dashboard** (`/app/dashboard`)
  - **Mark** (`/app/mark`)
  - **History** (`/app/history`)
  - **Profile** (`/app/profile`)

#### `src/context/AuthContext.tsx` — global auth state
A React Context providing `{ user, loading, login, register, logout, refreshUser }`:
- On mount, `refreshUser()` reads the JWT from `localStorage`; if present it calls `api.me()` to fetch the current user. If the token is invalid, it clears it.
- `login` / `register` store the returned token in `localStorage` and set the user in state.
- `logout` removes the token and clears the user.
- `useAuth()` hook exposes this; throws if used outside the provider.

#### `src/components/ProtectedRoute.tsx` — route guard
Wraps a `Route`. While auth is `loading` it renders nothing; once loaded, it renders children if a `user` exists, otherwise `<Redirect to="/login" />`.

#### `src/api/client.ts` — API layer
- Reads the base URL from `VITE_API_URL` (falls back to the deployed Railway URL).
- `authHeaders()` attaches `Authorization: Bearer <token>` from `localStorage`.
- `handle<T>()` parses JSON and throws the server's `error` message on non-2xx responses.
- Exposes typed methods: `register`, `login`, `me`, `today`, `history`, `markAttendance`.
- `markAttendance` builds a `FormData` with `latitude`, `longitude`, and the selfie `image` blob, and POSTs it as multipart.
- Also defines the shared `User` and `AttendanceRecord` TypeScript interfaces.

#### Pages

- **`Login.tsx`** — email/password form; calls `login()`, then redirects to the dashboard. Shows server error messages. Link to Register.
- **`Register.tsx`** — full registration form (name, email, password, role select `student`/`employee`, student/employee ID, department); calls `register()`, then redirects.
- **`Dashboard.tsx`** — greets the user, shows **Today's Status** (Present badge, or "Not marked yet" + a "Mark Attendance" button), and the **Attendance Percentage** card. Supports pull-to-refresh (`IonRefresher`); on load it fetches `api.today()` and `refreshUser()` in parallel.
- **`MarkAttendance.tsx`** — the key screen (see flow below). Uses a `Step` state machine (`idle → locating → capturing → submitting → success/error`). Also reverse-geocodes the coordinates to a human-readable place name via the free **BigDataCloud** API for display only. Has robust error messages for geolocation permission/timeout errors.
- **`History.tsx`** — fetches `api.history()` and lists every attendance record with a date and a colored status badge.
- **`Profile.tsx`** — shows an avatar (first initial), profile fields, attendance percentage, and a **Logout** button.

#### `src/theme/variables.css`
Ionic theming variables (colors, etc.).

---

## 6. End-to-End Flow: Marking Attendance

This is the app's central use case, combining GPS + selfie.

```
User taps "Mark Attendance" (MarkAttendance.tsx)
        │
        ▼
[locating]  Geolocation.getCurrentPosition({ enableHighAccuracy:true })
        │   → gets { latitude, longitude } from device GPS
        │   → (in parallel) reverse-geocode to a place name for display
        ▼
[capturing] Camera.getPhoto({ source: Camera, quality: 80 })
        │   → opens native/web camera, returns a photo webPath
        ▼
[submitting] fetch(photo.webPath) → Blob
        │   → api.markAttendance(lat, lon, blob)
        │       POST /api/attendance/mark  (multipart: latitude, longitude, image)
        │       Header: Authorization: Bearer <JWT>
        ▼
BACKEND (routes/attendance.ts)
        │  1. requireAuth verifies JWT → req.userId
        │  2. Multer saves selfie to uploadDir
        │  3. Validate lat/lon + file present
        │  4. Load allowed_locations, check isWithinRadius() for ANY location
        │        ├── NOT inside → delete file, 403 "not within authorized location"
        │        └── inside → upsert attendance row (one per user/day), status 'Present'
        ▼
[success] Frontend shows "Attendance marked successfully" + Back to Dashboard
[error]   Frontend shows a specific, friendly error message
```

### Login / auth flow
```
Register/Login form → POST /api/auth/{register,login}
   → backend hashes/verifies password (bcrypt) → returns JWT + user
   → frontend stores JWT in localStorage, sets user in AuthContext
   → every protected request sends "Authorization: Bearer <JWT>"
   → requireAuth middleware verifies it on the server
```

---

## 7. Complete API Reference

Base URL: `<API_URL>` (e.g. `https://<app>.up.railway.app/api`).

| Method | Path | Auth | Body / Params | Returns |
|--------|------|------|---------------|---------|
| `GET` | `/api/health` | No | — | `{ ok: true }` |
| `POST` | `/api/auth/register` | No | `{ name, email, password, role?, studentId?, department? }` | `{ token, user }` |
| `POST` | `/api/auth/login` | No | `{ email, password }` | `{ token, user }` |
| `GET` | `/api/users/me` | **Yes** | — | user + `attendancePercent` |
| `GET` | `/api/attendance/today` | **Yes** | — | `{ marked, record }` |
| `GET` | `/api/attendance/history` | **Yes** | — | `AttendanceRecord[]` |
| `POST` | `/api/attendance/mark` | **Yes** | multipart: `latitude`, `longitude`, `image` | saved record (`201`) |
| static | `/uploads/<filename>` | No | — | selfie image file |

Auth is `Authorization: Bearer <JWT>`. Tokens expire in **7 days**.

---

## 8. Security Model

- **Passwords**: never stored in plaintext; hashed with bcrypt (cost 10). `password_hash` is stripped from all responses.
- **Auth**: stateless JWT signed with `JWT_SECRET`; verified on every protected route via `requireAuth`.
- **Login errors**: generic message ("Invalid email or password") to avoid revealing which emails exist.
- **Geofence enforcement is server-side**: even if the client is tampered with, the backend independently verifies the coordinates against `allowed_locations` before recording attendance, and deletes the uploaded selfie if the check fails.
- **Upload limits**: selfies capped at 5 MB via Multer.
- **CORS**: currently open (`cors()` with no options) — tighten to specific origins for production.

### Known limitations (documented in README)
- Selfie coordinates are **trusted from the client** — a determined user could spoof GPS. Server verifies the *value* is inside the fence but can't prove the device wasn't faked.
- Selfies are stored on **local disk** (ephemeral in the cloud) — move to S3/Cloud Storage for production.
- "Today" is based on the **DB server timezone** (see the timezone caveat above).

---

## 9. Configuration & Environment Variables

### Backend (`backend/.env`)
| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string. Provided automatically by Railway's Postgres plugin. |
| `JWT_SECRET` | Secret used to sign/verify JWTs. Use a long random string. |
| `PORT` | Server port (injected by Railway; `4000` locally). |
| `PGSSL` | `true`/`false` to force SSL; leave unset for auto-detection. |
| `UPLOAD_DIR` | Absolute path for selfies; point to a mounted Volume in the cloud. |

### Frontend (`frontend/.env`)
| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Base URL of the backend API (e.g. `https://<app>.up.railway.app/api`). |

---

## 10. Build, Run & Deploy

### Local development
```bash
# Backend
cd backend
cp .env.example .env         # set DATABASE_URL and JWT_SECRET
createdb smart_attendance
npm install
npm run db:init              # applies schema.sql
npm run dev                  # http://localhost:4000

# Frontend
cd frontend
cp .env.example .env         # set VITE_API_URL
npm install
npm run dev                  # http://localhost:5173
```

### Run on Android (Camera + GPS need a device/emulator)
```bash
cd frontend
npm run build
npx cap add android
npm run cap:sync
npm run cap:android          # opens Android Studio → run on device/emulator
```
Grant Camera and Location permissions when prompted.

> `capacitor.config.ts` sets `androidScheme: "http"` so the WebView origin matches a plain-HTTP dev backend (avoids mixed-content blocks). Switch back to `"https"` once the backend is served over TLS.

### Deploy — Backend on Railway
- `railway.json` uses the **NIXPACKS** builder, health check `GET /api/health`, restart-on-failure.
- `nixpacks.toml`: installs with `npm ci --include=dev` (so TypeScript is available), builds with `npm run build`, starts with `npm run start`.
- Set service **Root Directory** to `backend`, add a **PostgreSQL** plugin, and set variables: `DATABASE_URL=${{ Postgres.DATABASE_URL }}`, `JWT_SECRET`, optionally `PGSSL` and `UPLOAD_DIR` (+ a Volume for persistent selfies).
- Schema is applied automatically on startup by `initDb()` — no manual step.

### Deploy — Frontend on Vercel
- `vercel.json` rewrites all routes to `/index.html` (SPA routing).
- Set `VITE_API_URL` to the deployed backend URL.

---

## 11. Project Structure Reference

```
1/
├── README.md                     # Setup & deploy quick reference
├── HOW_IT_WORKS.md               # Existing narrative docs
├── PROJECT_DOCUMENTATION.md      # (this file)
│
├── backend/                      # Node.js + Express + PostgreSQL API
│   ├── package.json
│   ├── tsconfig.json
│   ├── schema.sql                # DB schema (users, allowed_locations, attendance)
│   ├── railway.json / nixpacks.toml   # Railway deployment config
│   ├── .env.example
│   ├── uploads/                  # stored selfies (dev)
│   └── src/
│       ├── index.ts              # app bootstrap, middleware, route mounting
│       ├── db.ts                 # pg Pool + SSL auto-detect
│       ├── initDb.ts             # applies schema.sql on startup
│       ├── uploads.ts            # upload dir resolution
│       ├── middleware/auth.ts    # requireAuth (JWT verify)
│       ├── utils/geofence.ts     # haversine distance + isWithinRadius
│       └── routes/
│           ├── auth.ts           # register / login
│           ├── users.ts          # /me + attendance %
│           └── attendance.ts     # today / history / mark (geofence + selfie)
│
└── frontend/                     # Ionic React + Capacitor client
    ├── package.json
    ├── vite.config.ts
    ├── capacitor.config.ts
    ├── vercel.json
    ├── index.html
    ├── android/                  # generated native Android project
    └── src/
        ├── main.tsx              # React entry, Ionic CSS, PWA elements
        ├── App.tsx               # routes + tab shell
        ├── api/client.ts         # typed API client
        ├── context/AuthContext.tsx   # global auth state
        ├── components/ProtectedRoute.tsx
        ├── theme/variables.css
        └── pages/
            ├── Login.tsx
            ├── Register.tsx
            ├── Dashboard.tsx
            ├── MarkAttendance.tsx    # GPS + camera flow
            ├── History.tsx
            └── Profile.tsx
```

---

## 12. Summary

**Smart Attendance** is a full-stack, TypeScript hybrid mobile app:

- **Frontend**: Ionic React + Capacitor (native Camera & Geolocation), built with Vite, deployable as an Android app or a PWA on Vercel.
- **Backend**: Node.js + Express REST API with stateless JWT auth, bcrypt password hashing, Multer selfie uploads, and a Haversine-based server-side geofence check.
- **Database**: PostgreSQL with three tables (`users`, `allowed_locations`, `attendance`), one-mark-per-user-per-day enforced by a unique constraint.
- **Core idea**: attendance is only recorded when the user is verified to be **inside an authorized GPS radius** *and* submits a **live selfie**, with both the location check and data storage enforced on the server.
