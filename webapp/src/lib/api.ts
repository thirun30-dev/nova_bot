// Small client for the nova_dashboard.py HTTP API.
//
// Production: the static export is served by nova_dashboard.py itself, so the API is
// same-origin. Hosted elsewhere (Vercel): pass ?api=<robot URL>, see API_BASE below. Development (`npm run dev`): set NEXT_PUBLIC_ROBOT_API, e.g.
// http://localhost:8080, and start the dashboard with -p cors_origin:=http://localhost:3000.

import type { ApiResult } from "./types";

// Robot API base. On a page hosted elsewhere (Vercel), open it once as
//   https://<app>.vercel.app/?api=https://<tunnel>.trycloudflare.com&token=<token>
// and both are remembered in localStorage. NEXT_PUBLIC_ROBOT_API is the build-time default.
const BUILD_API = (process.env.NEXT_PUBLIC_ROBOT_API ?? "").replace(/\/$/, "");
export let API_BASE = BUILD_API;

let token: string | null = null;
let initialized = false;

/** Only https URLs (or http on localhost) are accepted as the robot API. */
function cleanApi(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const local = ["localhost", "127.0.0.1"].includes(u.hostname);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Reads ?api=… and ?token=… once (and remembers them), like the original dashboard. */
export function initToken(): string | null {
  if (typeof window === "undefined") return null;
  initialized = true;
  const q = new URLSearchParams(window.location.search);
  const urlToken = q.get("token");
  const urlApi = cleanApi(q.get("api"));
  let storedToken: string | null = null;
  let storedApi: string | null = null;
  try {
    storedToken = localStorage.getItem("nova_token");
    storedApi = localStorage.getItem("nova_api");
  } catch {}
  const api = urlApi ?? storedApi ?? BUILD_API;
  // a link that points at a different robot never gets the remembered token
  const tok = urlToken ?? (urlApi && urlApi !== storedApi ? null : storedToken);
  try {
    if (urlApi) localStorage.setItem("nova_api", urlApi);
    if (urlApi && urlApi !== storedApi && !urlToken) localStorage.removeItem("nova_token");
    if (urlToken) localStorage.setItem("nova_token", urlToken);
  } catch {}
  API_BASE = (api ?? "").replace(/\/$/, "");
  token = tok;
  return token;
}

/** Absolute API URL with the token appended. */
export function apiUrl(path: string, params: Record<string, string> = {}): string {
  if (!initialized) initToken();
  const q = new URLSearchParams(params);
  if (token) q.set("token", token);
  const qs = q.toString();
  return `${API_BASE}/api/${path}${qs ? `?${qs}` : ""}`;
}

export async function getJson<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  try {
    const r = await fetch(apiUrl(path, params), { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function postJson(path: string, body: unknown = {}): Promise<ApiResult & { status: number }> {
  try {
    const r = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as ApiResult;
    return { ...j, ok: r.ok && j.ok !== false, status: r.status };
  } catch {
    return { ok: false, message: "Robot dashboard server unreachable", status: 0 };
  }
}
