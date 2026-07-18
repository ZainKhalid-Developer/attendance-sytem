# Smart Attendance — How It Works

Complete technical walkthrough of the app: architecture, the Camera and Geolocation plugins,
every step of the "Mark Attendance" flow, the backend logic behind it, routing, auth, and the
Android-specific plumbing that makes it all run on a real device/emulator.

---

## 1. High-level architecture

```
┌─────────────────────────┐        HTTP/JSON        ┌──────────────────────────┐        SQL        ┌────────────┐
│   frontend/ (mobile app)│ ───────────────────────▶ │  backend/ (REST API)     │ ─────────────────▶│ PostgreSQL │
│   Ionic React + Capacitor│ ◀─────────────────────── │  Node.js + Express       │ ◀──────────────────│            │
└─────────────────────────┘                          └──────────────────────────┘                    └────────────┘
        │  native bridge
        ▼
┌─────────────────────────┐
│  Android OS              │
│  - GPS / FusedLocation   │
│  - Camera app (intent)   │
└─────────────────────────┘
```

- **frontend/** — an Ionic React single-page app, wrapped by **Capacitor** into a native Android
  shell. The UI is normal React/TypeScript rendered in a WebView; Capacitor plugins are the bridge
  that let that JavaScript call real native Android APIs (GPS, Camera).
- **backend/** — a plain Express REST API. It owns all business logic: auth, the geofence check,
  and persisting attendance records. The frontend never talks to Postgres directly — mobile apps
  can't hold DB credentials safely, so everything goes through the API.
- **PostgreSQL** — three tables: `users`, `attendance`, `allowed_locations` (see [schema.sql](backend/schema.sql)).

### Why a native shell at all (Capacitor)?

A plain website running in a mobile browser cannot silently access the device's GPS chip or open
the system camera app and get the resulting photo file back — browsers only expose limited,
permission-gated Web APIs (`navigator.geolocation`, `<input type=file capture>`), and even those
behave inconsistently across devices. Capacitor solves this by:

1. Bundling the built web app (`frontend/dist`) inside a real Android app (`frontend/android`).
2. Rendering it in a full-screen Android `WebView`.
3. Injecting a JS↔native **bridge**: JavaScript calls like `Camera.getPhoto()` are intercepted by
   Capacitor's runtime, forwarded to a native Kotlin/Java plugin class, which calls the real
   Android SDK, and the result is passed back into the WebView as a resolved JS Promise.

This is exactly what satisfies the assignment's "at least two native plugins" requirement — Camera
and Geolocation are both genuine native plugins, not JS-only shims.

---

## 2. Directory map

```
backend/
  schema.sql                 -- Postgres schema + seed data
  src/
    db.ts                    -- pg Pool (Postgres connection)
    index.ts                 -- Express app entrypoint, mounts routes
    middleware/auth.ts        -- JWT verification middleware
    routes/
      auth.ts                -- POST /api/auth/register, /login
      users.ts                -- GET /api/users/me
      attendance.ts           -- GET /today, GET /history, POST /mark  (the geofence + upload logic)
    utils/geofence.ts          -- haversine distance + isWithinRadius()

frontend/
  capacitor.config.ts         -- native shell config (appId, webDir, androidScheme)
  android/                    -- generated native Android project (Gradle, Java/Kotlin, Manifest)
    app/src/main/
      AndroidManifest.xml     -- declares CAMERA / location permissions
      res/xml/network_security_config.xml  -- allows plain-HTTP to the dev backend
  src/
    App.tsx                  -- route tree (tabs + auth-gated routes)
    api/client.ts             -- typed fetch wrapper for the backend REST API
    context/AuthContext.tsx    -- login/register/logout state, JWT storage
    pages/
      Login.tsx / Register.tsx
      Dashboard.tsx            -- today's status + attendance %
      MarkAttendance.tsx        -- ★ the Geolocation + Camera plugin flow
      History.tsx / Profile.tsx
```

---

## 3. The Geolocation Plugin

### Package
`@capacitor/geolocation` — installed in `frontend/package.json`, native Android code lives inside
`frontend/android` after `npx cap sync android` copies the plugin's `.aar` into the Gradle project.

### What it actually does under the hood
On Android, this plugin wraps Google Play Services' `FusedLocationProviderClient` — the same API
Google Maps uses. "Fused" means it blends GPS, Wi-Fi, and cell-tower signals to produce the best
available fix; it is **not** a raw GPS-only read. On a real phone this typically returns a location
within a few meters in seconds outdoors; on the emulator it returns whatever the emulator's mock
location is (see §7).

### Declaring the permission
Native code cannot call the location API without the manifest declaring intent, and the OS runtime
permission grant. Both are required:

```xml
<!-- frontend/android/app/src/main/AndroidManifest.xml -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

`ACCESS_FINE_LOCATION` is what actually gets you GPS-grade accuracy; `ACCESS_COARSE_LOCATION` is
a fallback for network-based location. Both are declared so the plugin can request whichever the
OS grants.

At runtime (first call), Android shows the user a system permission dialog — Capacitor's
Geolocation plugin handles requesting it automatically the first time `getCurrentPosition()` is
called if it hasn't been granted yet; if the user denies it, the call rejects with an error that
surfaces in the UI's catch block (see below).

### The actual call — [MarkAttendance.tsx](frontend/src/pages/MarkAttendance.tsx)

```ts
import { Geolocation } from "@capacitor/geolocation";

const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
const lat = position.coords.latitude;
const lon = position.coords.longitude;
```

- `getCurrentPosition()` returns a Promise resolving to a `Position` object (`coords.latitude`,
  `coords.longitude`, `coords.accuracy`, etc.) — it's a **one-shot** read, not a continuous watch
  (there's also a `watchPosition()` API in the plugin for continuous tracking, unused here since
  attendance only needs a single point-in-time reading).
- `enableHighAccuracy: true` tells the native layer to prefer GPS over the coarser network/Wi-Fi
  location, at the cost of taking a bit longer and using more battery.
- This call is `await`ed inside a `try/catch` — if location is denied, times out, or GPS is off,
  it throws, and the UI shows "Attendance Failed" with the error message (step becomes `"error"`).

### What happens to those coordinates
They are **not** validated on the device. They're sent as-is to the backend (see §5) — the phone
just reports where it thinks it is; the server is the source of truth for whether that's "close
enough" to campus.

---

## 4. The Camera Plugin

### Package
`@capacitor/camera` — same mechanism as Geolocation: JS call → native bridge → real Android Camera
app.

### What it actually does under the hood
`Camera.getPhoto()` launches Android's **system camera app** via an intent (in this project, the
emulator's `com.android.camera2` app is what opens) — the user is briefly leaving your app's UI
and using the actual native camera capture screen with its own shutter button, preview, and
confirm/retake controls. When the user confirms the photo, control returns to your WebView and the
plugin resolves the Promise with a reference to the saved image.

This is different from `<input type="file" capture>` in a plain website, which on many
Android/browser combos just opens a generic file picker — the native plugin guarantees a real
camera capture UI every time, with more control over resolution/quality/source.

### Declaring the permission

```xml
<!-- frontend/android/app/src/main/AndroidManifest.xml -->
<uses-permission android:name="android.permission.CAMERA" />
```

Plus a `FileProvider` (already present in the generated Capacitor Android project) that lets the
camera app write the photo to a location your app is allowed to read back from, without exposing
raw filesystem paths across app boundaries — this is standard Android practice for any app that
hands off to another app to produce a file.

### The actual call — [MarkAttendance.tsx](frontend/src/pages/MarkAttendance.tsx)

```ts
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

const photo = await Camera.getPhoto({
  resultType: CameraResultType.Uri,
  source: CameraSource.Camera,
  quality: 80,
});
```

- `source: CameraSource.Camera` forces the **camera app** specifically (as opposed to
  `CameraSource.Photos`, which would open the gallery/photo picker, or `CameraSource.Prompt`,
  which asks the user to choose). Since this is a selfie-verification feature, only a live camera
  capture makes sense — picking an old photo from the gallery would defeat the point.
- `resultType: CameraResultType.Uri` returns a local file URI (`photo.webPath`) rather than a
  base64 string — more memory-efficient for a full-resolution photo, and it's what lets us fetch it
  as a `Blob` next.
- `quality: 80` — JPEG compression quality (0–100), keeps the upload reasonably small without
  visibly degrading a face photo.

### Turning the result into an uploadable file

```ts
const response = await fetch(photo.webPath);
const blob = await response.blob();
await api.markAttendance(lat, lon, blob);
```

`photo.webPath` is a special Capacitor-served URL (like `capacitor://localhost/_capacitor_file_/...`)
that the WebView itself can `fetch()` — this converts the native file into an in-memory `Blob`,
which is what `FormData` (used by the upload, see §5) needs to attach as a file field.

---

## 5. Backend: the geofence check

This is the part that actually enforces "you must be on campus" — the device only *reports* a
location; it never decides whether that location is valid.

### Route — [attendance.ts](backend/src/routes/attendance.ts) `POST /api/attendance/mark`

```ts
router.post("/mark", requireAuth, upload.single("image"), async (req, res) => {
  const { latitude, longitude } = req.body;
  const lat = parseFloat(latitude);
  const lon = parseFloat(longitude);
  ...
  const locations = await pool.query("SELECT * FROM allowed_locations");
  const withinAny = locations.rows.some((loc) =>
    isWithinRadius(lat, lon, loc.latitude, loc.longitude, loc.radius_m)
  );

  if (!withinAny) {
    fs.unlink(req.file.path, () => {});   // delete the uploaded selfie, it doesn't count
    return res.status(403).json({
      error: "Attendance Failed: You are not within the authorized location.",
    });
  }
  // ...otherwise INSERT the attendance row (see §5.2)
});
```

Request pipeline for this one endpoint:
1. `requireAuth` — verifies the JWT from `Authorization: Bearer <token>`, attaches `req.userId`.
2. `upload.single("image")` — **Multer** middleware parses the incoming `multipart/form-data`
   request (latitude + longitude as text fields, the selfie as a file field named `"image"`),
   saves the file to `backend/uploads/`, and attaches metadata to `req.file`.
3. Handler body runs the geofence check, then either rejects (403) or inserts the row (201).

### The math — [geofence.ts](backend/src/utils/geofence.ts)

```ts
const EARTH_RADIUS_M = 6371000;

function distanceMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

function isWithinRadius(userLat, userLon, centerLat, centerLon, radiusM) {
  return distanceMeters(userLat, userLon, centerLat, centerLon) <= radiusM;
}
```

This is the **haversine formula** — the standard way to compute great-circle distance between two
lat/lon points on a sphere (accounting for the Earth's curvature; naive Pythagorean distance on
raw lat/lon degrees would be wrong and gets worse the farther from the equator you are). It's
checked against every row in `allowed_locations`, so multiple buildings/classrooms/campuses can
each have their own center point and radius, and a user passes if they're within range of **any**
one of them.

### `allowed_locations` table — [schema.sql](backend/schema.sql)

```sql
CREATE TABLE allowed_locations (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  radius_m    INTEGER NOT NULL DEFAULT 100
);

INSERT INTO allowed_locations (name, latitude, longitude, radius_m)
VALUES ('University Campus', 31.5204, 74.3587, 100);
```

To point this at a real campus/office, update or insert rows here with the real center coordinates
and an appropriate radius in meters.

### On success — inserting the record

```sql
INSERT INTO attendance (user_id, latitude, longitude, image_path, status)
VALUES ($1, $2, $3, $4, 'Present')
ON CONFLICT (user_id, date)
DO UPDATE SET latitude = EXCLUDED.latitude, ... marked_at = now()
RETURNING *;
```

`attendance` has a `UNIQUE (user_id, date)` constraint, so this is an **upsert**: marking twice in
one day just updates the existing row (re-marks with the latest selfie/coordinates) instead of
creating duplicates — `date` defaults to `CURRENT_DATE` on the Postgres server.

---

## 6. Full end-to-end sequence (what happens when you tap "Mark Attendance")

```
User taps "Mark Attendance" button
        │
        ▼
1. Geolocation.getCurrentPosition()  ──▶ Android FusedLocationProviderClient ──▶ returns {lat, lon}
        │  (UI shows "Checking your location...")
        ▼
2. Camera.getPhoto()  ──▶ launches native Camera app (separate Activity)
        │  user takes photo, taps ✓ to confirm ──▶ control returns to WebView
        │  (UI shows "Opening camera...")
        ▼
3. fetch(photo.webPath) → blob()        (turn the native file into an uploadable Blob)
        │
        ▼
4. POST /api/attendance/mark            (multipart: latitude, longitude, image file)
        │  (UI shows "Submitting attendance...")
        ▼
5. Backend: requireAuth → multer saves file → haversine check against allowed_locations
        │
        ├── OUTSIDE radius ──▶ 403, delete uploaded file, UI shows "Attendance Failed"
        │
        └── INSIDE radius ──▶ INSERT/UPSERT attendance row (status "Present") ──▶ 201
                    │
                    ▼
            UI shows "Attendance Recorded — Attendance marked successfully."
            Dashboard/History re-fetch and reflect the new status on next visit
```

Source for this state machine: [MarkAttendance.tsx](frontend/src/pages/MarkAttendance.tsx)'s
`Step` type (`"idle" | "locating" | "capturing" | "submitting" | "success" | "error"`) drives which
message/spinner is shown at each stage.

---

## 7. Android-specific plumbing that makes plugins actually work

A few pieces exist purely to make the Camera/Geolocation plugins (and the app generally) function
correctly inside the native shell — worth understanding since they're easy to trip over:

### `capacitor.config.ts` — `androidScheme: "http"`
Capacitor's WebView normally serves the app from `https://localhost` (a synthetic secure origin,
not a real server). If the backend it's calling is plain HTTP (as in local dev), the browser's
**mixed-content policy** silently blocks every `fetch()` call to it — nothing to do with the
plugins directly, but without this fix the app's API calls (including submitting the attendance
mark) would fail even though the plugins themselves work fine. Set back to `"https"` once the
backend has TLS.

### `network_security_config.xml`
Android 9+ blocks plaintext (cleartext) HTTP network traffic by default at the OS level, separate
from the WebView's own mixed-content check above. This file explicitly allows cleartext to
`10.0.2.2` (the special alias the Android emulator uses to reach the host machine's `localhost`)
and `localhost` itself.

### AndroidManifest permissions
Already covered per-plugin above — `CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
plus `INTERNET` (needed for any network call at all, not plugin-specific).

### Testing GPS on an emulator
Emulators don't have real GPS hardware. To test the geofence logic without a physical device,
fake the emulator's location via its console:
```bash
adb emu geo fix <longitude> <latitude>
```
(note: longitude first, then latitude — the reverse of how they're usually spoken). This was used
during development to place the emulator "at" the seeded campus coordinates and confirm both the
success and failure (403) paths of the geofence check.

---

## 8. Everything else — routing, auth, screens

### Auth
[AuthContext.tsx](frontend/src/context/AuthContext.tsx) holds `user`/`loading` state and exposes
`login`/`register`/`logout`. On success, the backend's JWT is stored in `localStorage`; every
subsequent API call attaches it as `Authorization: Bearer <token>` ([client.ts](frontend/src/api/client.ts)).
The backend's [`requireAuth`](backend/src/middleware/auth.ts) middleware verifies that token and
attaches `req.userId` for every protected route.

### Routing — [App.tsx](frontend/src/App.tsx)
- `/login`, `/register` — public.
- `/app/*` — everything behind `ProtectedRoute` (redirects to `/login` if not authenticated):
  `/app/dashboard`, `/app/mark`, `/app/history`, `/app/profile`, rendered inside an `IonTabs` +
  bottom tab bar (`AuthedTabs`).
- Routes are deliberately namespaced under `/app` rather than living at the bare root — Ionic's
  `IonRouterOutlet` manages an animated view stack and gets confused if a non-`exact` catch-all
  route (like the "protect everything under `/`" wrapper) overlaps with sibling routes like
  `/login`. Namespacing avoids that overlap entirely.

### Screens
| Screen | File | Purpose |
|---|---|---|
| Login | `pages/Login.tsx` | email/password → JWT |
| Register | `pages/Register.tsx` | create account (name, email, password, role, student/employee ID, department) |
| Dashboard | `pages/Dashboard.tsx` | today's status, attendance %, shortcut to Mark Attendance |
| Mark Attendance | `pages/MarkAttendance.tsx` | the Geolocation + Camera flow described above |
| History | `pages/History.tsx` | full attendance log, `GET /api/attendance/history` |
| Profile | `pages/Profile.tsx` | name/email/ID/department/attendance %, logout |

### Backend API surface
| Method & Path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register` | – | create account, returns JWT |
| `POST /api/auth/login` | – | returns JWT |
| `GET /api/users/me` | JWT | profile + computed attendance % |
| `GET /api/attendance/today` | JWT | whether today is already marked |
| `GET /api/attendance/history` | JWT | all past records |
| `POST /api/attendance/mark` | JWT | geolocation + selfie upload → geofence check → record |
