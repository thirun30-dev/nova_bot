"use client";

// One live connection to the robot (Server-Sent Events) shared by every section.
// It lives in the root layout, so it survives client-side navigation between sections.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl, getJson, initToken, postJson } from "@/lib/api";
import type { EventItem, MapData, RobotState, StackOptions, Station } from "@/lib/types";

type Conn = "connecting" | "connected" | "stale" | "offline";
type Toast = { id: number; text: string; error: boolean };

type Ctx = {
  state: RobotState | null;
  conn: Conn;
  /** "poll" when a proxy (e.g. a Cloudflare tunnel) buffers the live stream */
  transport: "stream" | "poll";
  events: EventItem[];
  stations: Station[];
  options: StackOptions | null;
  map: MapData | null;
  odometer: number;
  speedHistory: number[];
  toasts: Toast[];
  toast: (text: string, error?: boolean) => void;
  /** POST to the API; shows the server's message as an error toast when it fails. */
  act: (path: string, body?: unknown, okText?: string) => Promise<boolean>;
  reloadOptions: () => void;
  toggleEstop: () => Promise<void>;
};

const RobotContext = createContext<Ctx | null>(null);

export function useRobot(): Ctx {
  const c = useContext(RobotContext);
  if (!c) throw new Error("useRobot must be used inside <RobotProvider>");
  return c;
}

export function RobotProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RobotState | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [transport, setTransport] = useState<"stream" | "poll">("stream");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [options, setOptions] = useState<StackOptions | null>(null);
  const [map, setMap] = useState<MapData | null>(null);
  const [odometer, setOdometer] = useState(0);
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const seen = useRef({ map: -1, maps: -1, stations: -1 });
  const lastPose = useRef<{ x: number; y: number } | null>(null);
  const lastMsg = useRef(0);
  const toastId = useRef(0);
  const estopRef = useRef(false);

  const toast = useCallback((text: string, error = false) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const act = useCallback(
    async (path: string, body: unknown = {}, okText?: string) => {
      const r = await postJson(path, body);
      if (!r.ok) toast(r.message || r.error || `Request failed (${r.status})`, true);
      else if (okText) toast(okText);
      return !!r.ok;
    },
    [toast],
  );

  const reloadOptions = useCallback(() => {
    getJson<StackOptions>("stack/options").then((o) => o && setOptions(o));
  }, []);

  const toggleEstop = useCallback(async () => {
    await act("estop", { on: !estopRef.current });
  }, [act]);

  // live stream
  useEffect(() => {
    initToken();
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let probe: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let polling = false;
    let lastSeq = 0;

    const onState = (s: RobotState) => {
      lastMsg.current = Date.now();
      if (s.events.length) lastSeq = Math.max(lastSeq, ...s.events.map((e) => e.seq));
      estopRef.current = s.estop;
      setState(s);
      setConn("connected");
      if (s.events.length) setEvents((e) => [...s.events.slice().reverse(), ...e].slice(0, 300));
      if (s.velocity) setSpeedHistory((h) => [...h.slice(-299), s.velocity!.vx]);
      if (s.pose) {
        const p = lastPose.current;
        if (p) {
          const d = Math.hypot(s.pose.x - p.x, s.pose.y - p.y);
          if (d < 1) setOdometer((o) => o + d); // ignore jumps (relocalization)
        }
        lastPose.current = { x: s.pose.x, y: s.pose.y };
      }
      const k = seen.current;
      if (s.map_version !== k.map && s.map_version > 0) {
        k.map = s.map_version;
        getJson<MapData>("map").then((m) => m && setMap(m));
      }
      if (s.maps_version !== k.maps) {
        k.maps = s.maps_version;
        getJson<StackOptions>("stack/options").then((o) => o && setOptions(o));
      }
      if (s.stations_version !== k.stations) {
        k.stations = s.stations_version;
        getJson<Station[]>("stations").then((st) => Array.isArray(st) && setStations(st));
      }
    };

    // Polling fallback: some proxies (Cloudflare quick tunnels) hold an event stream back
    // until it ends, so the page would sit at "connecting" forever.
    const poll = async () => {
      if (closed) return;
      const s = await getJson<RobotState>("state", { since: String(lastSeq) });
      if (closed) return;
      if (s) onState(s);
      else setConn("offline");
      retry = setTimeout(poll, s ? 250 : 2000);
    };
    const startPolling = () => {
      if (polling || closed) return;
      polling = true;
      es?.close();
      clearTimeout(retry);
      setTransport("poll");
      poll();
    };

    const open = () => {
      let got = false;
      es = new EventSource(apiUrl("stream"));
      es.onopen = () => {
        // connected but no data within 4 s: the stream is being buffered somewhere
        clearTimeout(probe);
        probe = setTimeout(() => !got && startPolling(), 4000);
      };
      es.onmessage = (ev) => {
        got = true;
        onState(JSON.parse(ev.data) as RobotState);
      };
      es.onerror = () => {
        clearTimeout(probe);
        setConn("offline");
        es?.close();
        if (!closed && !polling) retry = setTimeout(open, 2000);
      };
    };
    open();

    const stale = setInterval(() => {
      if (lastMsg.current && Date.now() - lastMsg.current > 2500) setConn((c) => (c === "connected" ? "stale" : c));
    }, 1000);
    return () => {
      closed = true;
      es?.close();
      clearTimeout(retry);
      clearTimeout(probe);
      clearInterval(stale);
    };
  }, []);

  // Space = E-STOP from anywhere (except while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code !== "Space" || e.repeat || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      e.preventDefault();
      toggleEstop();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [toggleEstop]);

  const value = useMemo<Ctx>(
    () => ({ state, conn, transport, events, stations, options, map, odometer, speedHistory, toasts, toast, act, reloadOptions, toggleEstop }),
    [state, conn, transport, events, stations, options, map, odometer, speedHistory, toasts, toast, act, reloadOptions, toggleEstop],
  );

  return <RobotContext.Provider value={value}>{children}</RobotContext.Provider>;
}
