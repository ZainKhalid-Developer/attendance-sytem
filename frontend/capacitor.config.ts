import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.smartattendance",
  appName: "Smart Attendance",
  webDir: "dist",
  server: {
    // "http" so the WebView's own origin matches a plain-HTTP local dev backend
    // (avoids mixed-content blocks). Switch back to "https" once the backend is on TLS.
    androidScheme: "http",
  },
};

export default config;
