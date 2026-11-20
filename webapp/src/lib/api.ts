// Small client for the nova_dashboard.py HTTP API.
//
// Two ways the page reaches the robot:
//  - Served by nova_dashboard.py itself (http://<robot>:8080): same origin, connects on load.
//  - Hosted elsewhere (Vercel): nothing happens until the user enters the robot's address and
//    token and presses Connect (see connectTo). An https page can only call an https robot, so
//    the robot also serves the API on https://<robot-ip>:8443 with a self-signed certificate,
//    which the browser has to accept once (open that address and click through the warning).
// Development (`npm run dev`): set NEXT_PUBLIC_ROBOT_API, e.g. http://localhost:8080, and
// start the dashboard with -p cors_origin:=http://localhost:3000.

import type { ApiResult } from "./types";

const BUILD_API = (process.env.NEXT_PUBLIC_ROBOT_API ?? "").replace(/\/$/, "");
export let API_BASE = BUILD_API;
let token: string | null = null;

export const HTTPS_PORT = 8443;
export const HTTP_PORT = 8080;

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** "10.0.0.5", "nova.local:8443" or a full URL -> robot API origin, or null if invalid.
 *  Without a scheme: https on port 8443 from an https page, else http on 8080. */
export function robotOrigin(raw: string): string | null {
  const s = raw.trim().replace(/\/+$/, "");
  if (!s) return null;
  const pageHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  const withScheme = /^[a-z]+:\/\//i.test(s) ? s : `${pageHttps ? "https" : "http"}://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.port && !/^[a-z]+:\/\//i.test(s)) u.port = String(u.protocol === "https:" ? HTTPS_PORT : HTTP_PORT);
    return u.origin;
  } catch {
    return null;
  }
}

/** What the connect form starts with: ?api= / ?token= from a link, else the last robot used. */
export function savedConnection(): { address: string; token: string } {
  if (typeof window === "undefined") return { address: "", token: "" };
  const q = new URLSearchParams(window.location.search);
  const api = q.get("api") ?? load("nova_api") ?? "";
  const tok = q.get("token") ?? load("nova_token") ?? "";
  return { address: api.replace(/^https?:\/\//, ""), token: tok };
}

/** True when this page was served by nova_dashboard.py (its API answers on the same origin). */
export async function servedByRobot(): Promise<boolean> {
  if (BUILD_API) return true; // dev build pointed at a robot
  try {
    const r = await fetch("/api/state?probe=1", { cache: "no-store" });
    return (r.headers.get("content-type") ?? "").includes("application/json");
  } catch {
    return false;
  }
}

/** Same-origin mode: token from ?token= (remembered) as before. */
export function selectSameOrigin() {
  const q = new URLSearchParams(window.location.search);
  const urlToken = q.get("token");
  if (urlToken) store("nova_token_local", urlToken);
  API_BASE = BUILD_API;
  token = urlToken ?? load("nova_token_local");
}

export type ConnectResult = { ok: true } | { ok: false; reason: "address" | "token" | "unreachable"; origin?: string };

/** Try the robot at `address`; on success all API calls go there and it is remembered. */
export async function connectTo(address: string, tok: string): Promise<ConnectResult> {
  const origin = robotOrigin(address);
  if (!origin) return { ok: false, reason: "address" };
  try {
    const q = new URLSearchParams({ since: "0" });
    if (tok) q.set("token", tok);
    const r = await fetch(`${origin}/api/state?${q}`, { cache: "no-store" });
    if (r.status === 401) return { ok: false, reason: "token", origin };
    if (!r.ok) return { ok: false, reason: "unreachable", origin };
  } catch {
    return { ok: false, reason: "unreachable", origin };
  }
  API_BASE = origin;
  token = tok || null;
  store("nova_api", origin);
  store("nova_token", tok || null);
  return { ok: true };
}

export function disconnectApi() {
  token = null;
  API_BASE = BUILD_API;
}

/** Absolute API URL with the token appended. */
export function apiUrl(path: string, params: Record<string, string> = {}): string {
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
