// Small client for the nova_dashboard.py HTTP API.
//
// Production: the static export is served by nova_dashboard.py itself, so the API is
// same-origin. Development (`npm run dev`): set NEXT_PUBLIC_ROBOT_API, e.g.
// http://localhost:8080, and start the dashboard with -p cors_origin:=http://localhost:3000.

import type { ApiResult } from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_ROBOT_API ?? "").replace(/\/$/, "");

let token: string | null = null;

/** Reads ?token=… once (and remembers it), like the original dashboard. */
export function initToken(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("token");
  try {
    if (fromUrl) localStorage.setItem("nova_token", fromUrl);
    token = fromUrl ?? localStorage.getItem("nova_token");
  } catch {
    token = fromUrl;
  }
  return token;
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
