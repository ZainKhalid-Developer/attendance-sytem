const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://attendance-sytem-production.up.railway.app/api";

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  student_id: string | null;
  department: string | null;
  attendancePercent?: number;
}

export interface AttendanceRecord {
  date: string;
  status: "Present" | "Absent";
  marked_at: string;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}

export const api = {
  register(body: {
    name: string;
    email: string;
    password: string;
    role?: string;
    studentId?: string;
    department?: string;
  }) {
    return fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<{ token: string; user: User }>(r));
  },

  login(email: string, password: string) {
    return fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then((r) => handle<{ token: string; user: User }>(r));
  },

  me() {
    return fetch(`${API_URL}/users/me`, { headers: authHeaders() }).then((r) =>
      handle<User>(r)
    );
  },

  today() {
    return fetch(`${API_URL}/attendance/today`, { headers: authHeaders() }).then((r) =>
      handle<{ marked: boolean; record: AttendanceRecord | null }>(r)
    );
  },

  history() {
    return fetch(`${API_URL}/attendance/history`, { headers: authHeaders() }).then((r) =>
      handle<AttendanceRecord[]>(r)
    );
  },

  markAttendance(latitude: number, longitude: number, imageBlob: Blob) {
    const form = new FormData();
    form.append("latitude", String(latitude));
    form.append("longitude", String(longitude));
    form.append("image", imageBlob, "selfie.jpg");

    return fetch(`${API_URL}/attendance/mark`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    }).then((r) => handle<AttendanceRecord>(r));
  },
};
