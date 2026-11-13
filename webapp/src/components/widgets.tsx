"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import { Icon } from "./icons";
import { useRobot } from "./RobotProvider";
import { Badge, Button, Card, cx, deg, Dot, Empty, fmt, Stat } from "./ui";

/* ---------------- robot numbers ---------------- */
export function RobotStats({ compact = false }: { compact?: boolean }) {
  const { state: S, odometer } = useRobot();
  const p = S?.pose;
  return (
    <div className={cx("grid gap-2", compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3")}>
      <Stat label="X" value={p ? p.x.toFixed(2) : "–"} unit="m" />
      <Stat label="Y" value={p ? p.y.toFixed(2) : "–"} unit="m" />
      <Stat label="Heading" value={p ? `${deg(p.yaw).toFixed(0)}°` : "–"} hint={p ? `frame: ${p.frame}` : undefined} />
      <Stat label="Speed" value={fmt(S?.velocity?.vx)} unit="m/s" />
      <Stat label="Turn rate" value={fmt(S?.velocity?.wz)} unit="rad/s" />
      <Stat label="Battery" value={S?.battery?.percent != null ? S.battery.percent.toFixed(0) : "n/a"}
        unit={S?.battery?.percent != null ? "%" : undefined} hint="Needs /battery_state (the sim has none)" />
      {!compact && <>
        <Stat label="Cmd speed" value={fmt(S?.command.vx)} unit="m/s" hint={`angular ${fmt(S?.command.wz)} rad/s`} />
        <Stat label="Loc. error" value={S?.amcl ? fmt(S.amcl.std_xy * 100, 0) : S?.mode === "slam" ? "SLAM" : "–"}
          unit={S?.amcl ? "cm" : undefined} hint="AMCL position standard deviation" />
        <Stat label="Distance" value={odometer.toFixed(1)} unit="m" hint="Driven since this page was opened" />
      </>}
    </div>
  );
}

/* ---------------- speed trace ---------------- */
export function SpeedSpark({ className = "h-14" }: { className?: string }) {
  const { speedHistory } = useRobot();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const d = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    c.width = w * d; c.height = h * d;
    const g = c.getContext("2d")!;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.strokeStyle = "#1c2945"; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    if (speedHistory.length > 1) {
      const n = speedHistory.length - 1;
      g.strokeStyle = "#22d3ee"; g.lineWidth = 1.5; g.beginPath();
      speedHistory.forEach((v, i) => { const x = (i / n) * w, y = h / 2 - (v / 0.5) * (h / 2 - 3); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    }
    g.fillStyle = "#64748b"; g.font = "10px ui-sans-serif, system-ui"; g.textAlign = "right";
    g.fillText("speed · last 60 s", w - 2, h - 3);
  }, [speedHistory]);
  return <canvas ref={ref} className={cx("block w-full", className)} />;
}

/* ---------------- navigation status ---------------- */
export function NavStatus() {
  const { state: S, act } = useRobot();
  const n = S?.nav;
  const live = !!n && ["sending", "navigating"].includes(n.state);
  const fb = live ? n!.feedback : null;
  const target = !n?.target ? "No active goal" : n.target.x === null ? n.target.label
    : `${n.target.label} → (${n.target.x.toFixed(2)}, ${n.target.y!.toFixed(2)})`;
  const pct = n?.state === "succeeded" ? 100 : fb && n?.progress !== undefined ? n.progress * 100 : 0;
  return (
    <div>
      <div className="mb-3 flex min-w-0 items-center gap-2.5">
        <Badge state={n?.state}>{n?.state ?? "idle"}</Badge>
        <span className="truncate text-slate-400">{target}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Remaining" value={fb ? fmt(fb.distance_remaining) : "–"} unit={fb ? "m" : undefined} />
        <Stat label="ETA" value={fb ? fmt(fb.eta, 0) : "–"} unit={fb ? "s" : undefined} />
        <Stat label="Recoveries" value={fb ? fb.recoveries : "–"} />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-800">
        <div className="h-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      {S?.mission.active && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400">Mission:</span>
          {S.mission.queue.map((q, i) => (
            <span key={i} className={cx("rounded-md px-2 py-0.5", i === 0 ? "bg-blue-900 text-blue-100" : "bg-ink-700")}>{i === 0 ? "▶ " : ""}{q}</span>
          ))}
          {S.mission.loop && <span className="rounded-md bg-ink-700 px-2 py-0.5">↻ loop</span>}
        </div>
      )}
      <Button variant="danger" className="mt-3" disabled={!live && !S?.mission.active}
        onClick={() => act("cancel", {}, "Navigation canceled")}>
        <Icon name="stop" className="size-3.5" /> Cancel navigation
      </Button>
    </div>
  );
}

/* ---------------- manual drive ---------------- */
type Vec = [number, number];

/** Streams /api/cmd_vel at 10 Hz while a direction is held; always sends a stop on release/unmount. */
export function useDrive() {
  const { state } = useRobot();
  const [lin, setLin] = useState(0.3);
  const [ang, setAng] = useState(0.8);
  const [vec, setVecState] = useState<Vec>([0, 0]);
  const cur = useRef<{ vec: Vec; lin: number; ang: number }>({ vec: [0, 0], lin, ang });
  useEffect(() => { cur.current.lin = lin; cur.current.ang = ang; }, [lin, ang]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const setVec = useCallback((v: Vec) => {
    cur.current.vec = v;
    setVecState(v);
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    const send = () => {
      const c = cur.current;
      fetch(apiUrl("cmd_vel"), { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vx: c.vec[0] * c.lin, wz: c.vec[1] * c.ang }) }).catch(() => {});
    };
    send();
    if (v[0] || v[1]) timer.current = setInterval(send, 100);
  }, []);

  // stop when the section is left
  useEffect(() => () => { if (timer.current) { clearInterval(timer.current); setVec([0, 0]); } }, [setVec]);
  // stop when the e-stop engages
  useEffect(() => { if (state?.estop && (cur.current.vec[0] || cur.current.vec[1])) setVec([0, 0]); }, [state?.estop, setVec]);
  return { lin, setLin, ang, setAng, vec, setVec };
}

const KEYMAP: Record<string, Vec> = { w: [1, 0], arrowup: [1, 0], s: [-1, 0], arrowdown: [-1, 0],
  a: [0, 1], arrowleft: [0, 1], d: [0, -1], arrowright: [0, -1] };

/** WASD / arrow keys drive while this component is mounted. */
export function useDriveKeys(setVec: (v: Vec) => void) {
  useEffect(() => {
    const keys = new Set<string>();
    const vec = (): Vec => {
      const v: Vec = [0, 0];
      keys.forEach((k) => { v[0] += KEYMAP[k][0]; v[1] += KEYMAP[k][1]; });
      return [Math.max(-1, Math.min(1, v[0])), Math.max(-1, Math.min(1, v[1]))];
    };
    const typing = (e: KeyboardEvent) => ["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)
      && (e.target as HTMLInputElement).type !== "range";
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!KEYMAP[k] || typing(e) || keys.has(k)) return;
      e.preventDefault(); keys.add(k); setVec(vec());
    };
    const up = (e: KeyboardEvent) => { if (keys.delete(e.key.toLowerCase())) setVec(vec()); };
    const blur = () => { if (keys.size) { keys.clear(); setVec([0, 0]); } };
    addEventListener("keydown", down); addEventListener("keyup", up); addEventListener("blur", blur);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", blur); };
  }, [setVec]);
}

export function DrivePad({ large = false }: { large?: boolean }) {
  const { state: S } = useRobot();
  const { lin, setLin, ang, setAng, vec, setVec } = useDrive();
  useDriveKeys(setVec);
  const btn = (v: Vec, icon: "up" | "down" | "left" | "right" | "stop", label: string) => {
    const held = vec[0] === v[0] && vec[1] === v[1] && (v[0] || v[1]);
    return (
      <button aria-label={label} title={label}
        className={cx("grid place-items-center rounded-xl border transition-colors select-none touch-none",
          large ? "size-20" : "size-14",
          held ? "border-accent bg-accent text-white" : "border-ink-600 bg-ink-800 hover:border-accent",
          icon === "stop" && "text-rose-300")}
        onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setVec(v); }}
        onPointerUp={() => setVec([0, 0])} onPointerCancel={() => setVec([0, 0])}>
        <Icon name={icon} className={large ? "size-8" : "size-6"} />
      </button>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="grid grid-cols-3 gap-2">
        <span />{btn([1, 0], "up", "Forward (W)")}<span />
        {btn([0, 1], "left", "Turn left (A)")}{btn([0, 0], "stop", "Stop")}{btn([0, -1], "right", "Turn right (D)")}
        <span />{btn([-1, 0], "down", "Reverse (S)")}<span />
      </div>
      <div className="min-w-48 flex-1 space-y-3 text-xs text-slate-400">
        <label className="block">
          Linear speed <b className="font-mono text-slate-100">{lin.toFixed(2)}</b> m/s
          <input type="range" min={0.05} max={0.5} step={0.05} value={lin} onChange={(e) => setLin(+e.target.value)} className="mt-1 w-full" />
        </label>
        <label className="block">
          Turn speed <b className="font-mono text-slate-100">{ang.toFixed(1)}</b> rad/s
          <input type="range" min={0.2} max={1.5} step={0.1} value={ang} onChange={(e) => setAng(+e.target.value)} className="mt-1 w-full" />
        </label>
        <p>Hold a button or W A S D / arrow keys. Overrides Nav2 while held; the gamepad and E-STOP still win.</p>
        {S?.estop && <p className="font-semibold text-rose-300">E-STOP is engaged: driving is blocked.</p>}
      </div>
    </div>
  );
}

/* ---------------- camera ---------------- */
export function Camera() {
  const { state: S } = useRobot();
  // the <img> (and its MJPEG connection) goes away when the section is left
  const src = S?.camera ? apiUrl("camera.mjpg") : null;
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-ink-950">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="Robot camera" className="size-full object-cover" />}
      {!S?.camera && (
        <div className="absolute inset-0 grid place-items-center text-slate-500">
          <div className="flex flex-col items-center gap-2"><Icon name="camera" className="size-8" />No camera stream</div>
        </div>
      )}
    </div>
  );
}

/* ---------------- health ---------------- */
export function Health() {
  const { state: S } = useRobot();
  if (!S) return <Empty>Waiting for the robot…</Empty>;
  const rows = S.health.filter((h) => h.up || !["slam_toolbox", "amcl", "map_server"].includes(h.node) ||
    (S.mode === "slam" ? h.node === "slam_toolbox" : h.node !== "slam_toolbox"));
  return (
    <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
      {rows.map((h) => {
        const lc = S.lifecycle[h.node];
        return (
          <div key={h.node} className="flex min-w-0 items-center gap-2 rounded-lg bg-ink-800 px-3 py-2" title={h.node}>
            <Dot tone={!h.up ? "bad" : lc && lc !== "active" ? "warn" : "ok"} />
            <span className="min-w-0 flex-1 truncate">{h.role}</span>
            <span className="text-xs text-slate-400">{h.up ? lc || "up" : "down"}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- event log ---------------- */
export function EventLog({ limit = 300, className = "max-h-80" }: { limit?: number; className?: string }) {
  const { events } = useRobot();
  if (!events.length) return <Empty>No events yet</Empty>;
  return (
    <ul className={cx("overflow-y-auto text-xs", className)}>
      {events.slice(0, limit).map((e) => (
        <li key={e.seq} className="flex gap-3 border-b border-ink-800 py-1.5">
          <time className="shrink-0 font-mono text-slate-500">{e.t}</time>
          <span className={cx(e.level === "warn" && "text-amber-200", e.level === "error" && "text-rose-300")}>{e.text}</span>
        </li>
      ))}
    </ul>
  );
}

export { Card };
