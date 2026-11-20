"use client";

// Canvas map: occupancy grid, lidar, Nav2 path, goal, stations, robot.
// interactive=false gives a read-only preview (Overview section).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRobot } from "./RobotProvider";
import { ROBOT } from "@/lib/robotModel";

export type Tool = "nav" | "pose" | "pan";
export type Layers = { scan: boolean; plan: boolean; stations: boolean; grid: boolean };

type Props = {
  interactive?: boolean;
  tool?: Tool;
  layers?: Layers;
  follow?: boolean;
  onFollowChange?: (f: boolean) => void;
  /** increments ask the view to fit the map / zoom */
  fitSignal?: number;
  zoomSignal?: { n: number; factor: number };
  onPick?: (kind: "nav" | "pose", x: number, y: number, yaw: number) => void;
  className?: string;
};

const ALL: Layers = { scan: true, plan: true, stations: true, grid: true };
const C = { unknown: "#151c2c", free: [222, 228, 238], occ: [11, 15, 25], robot: "#34d399", estop: "#f43f5e",
  scan: "#fb7185", plan: "#22d3ee", station: "#a78bfa", pose: "#facc15" };

export default function MapView({ interactive = true, tool = "nav", layers = ALL, follow = false, onFollowChange,
  fitSignal = 0, zoomSignal, onPick, className = "" }: Props) {
  const { state: S, map, stations } = useRobot();
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLCanvasElement | null>(null);
  const view = useRef({ cx: 0, cy: 0, scale: 60, fitted: false });
  const drag = useRef<null | { kind: Tool; start: [number, number]; cur: [number, number]; world: [number, number]; v0: { cx: number; cy: number } }>(null);
  const [coords, setCoords] = useState("");
  const live = useRef({ S, stations, layers, follow, map });
  useEffect(() => { live.current = { S, stations, layers, follow, map }; });

  const size = () => {
    const c = cv.current!;
    const d = devicePixelRatio || 1;
    return { w: c.width / d, h: c.height / d, d };
  };
  const toScreen = (x: number, y: number): [number, number] => {
    const { w, h } = size(), v = view.current;
    return [w / 2 + (x - v.cx) * v.scale, h / 2 - (y - v.cy) * v.scale];
  };
  const toWorld = (sx: number, sy: number): [number, number] => {
    const { w, h } = size(), v = view.current;
    return [v.cx + (sx - w / 2) / v.scale, v.cy - (sy - h / 2) / v.scale];
  };

  const draw = useCallback(() => {
    const c = cv.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const { w, h, d } = size();
    const { S, stations, layers, follow, map } = live.current;
    const v = view.current;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = C.unknown;
    ctx.fillRect(0, 0, w, h);
    if (follow && S?.pose) { v.cx = S.pose.x; v.cy = S.pose.y; }

    if (map && img.current) {
      const [sx, sy] = toScreen(map.origin[0], map.origin[1] + map.height * map.resolution);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img.current, sx, sy, map.width * map.resolution * v.scale, map.height * map.resolution * v.scale);
    }
    if (layers.grid) {
      const step = v.scale < 25 ? 5 : 1;
      const [x0, y1] = toWorld(0, 0), [x1, y0] = toWorld(w, h);
      ctx.strokeStyle = "rgba(120,150,200,0.14)"; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const [s] = toScreen(x, 0); ctx.moveTo(s, 0); ctx.lineTo(s, h); }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const [, s] = toScreen(0, y); ctx.moveTo(0, s); ctx.lineTo(w, s); }
      ctx.stroke();
      const [ax, ay] = toScreen(0, 0);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#f43f5eaa"; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + 0.5 * v.scale, ay); ctx.stroke();
      ctx.strokeStyle = "#34d399aa"; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - 0.5 * v.scale); ctx.stroke();
    }
    if (layers.stations) {
      ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
      for (const s of stations) {
        const [sx, sy] = toScreen(s.x, s.y);
        ctx.fillStyle = C.station; ctx.strokeStyle = "#1e1b4b"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy - 8); ctx.lineTo(sx + 8, sy); ctx.lineTo(sx, sy + 8); ctx.lineTo(sx - 8, sy); ctx.closePath();
        ctx.fill(); ctx.stroke();
        const tw = ctx.measureText(s.name).width;
        ctx.fillStyle = "#0b1020d9"; ctx.fillRect(sx + 11, sy - 9, tw + 10, 18);
        ctx.fillStyle = "#ddd6fe"; ctx.fillText(s.name, sx + 16, sy + 4);
      }
    }
    if (S && layers.plan && S.plan.length > 3) {
      ctx.strokeStyle = C.plan; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.beginPath();
      for (let i = 0; i < S.plan.length; i += 2) { const [sx, sy] = toScreen(S.plan[i], S.plan[i + 1]); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); }
      ctx.stroke();
    }
    const t = S?.nav.target;
    if (S && t && t.x !== null && t.y !== null && ["sending", "navigating"].includes(S.nav.state)) {
      const [sx, sy] = toScreen(t.x, t.y);
      ctx.strokeStyle = C.plan; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 11, 0, 7); ctx.stroke();
      arrow(ctx, sx, sy, t.yaw, 22, C.plan);
    }
    if (S && layers.scan) {
      ctx.fillStyle = C.scan;
      for (let i = 0; i < S.scan.length; i += 2) { const [sx, sy] = toScreen(S.scan[i], S.scan[i + 1]); ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3); }
    }
    if (S?.pose) drawRobot(ctx, ...toScreen(S.pose.x, S.pose.y), S.pose.yaw, v.scale, S.estop ? C.estop : C.robot);
    const g = drag.current;
    if (g && g.kind !== "pan") {
      const [sx, sy] = toScreen(...g.world);
      const dx = g.cur[0] - g.start[0], dy = g.cur[1] - g.start[1];
      arrow(ctx, sx, sy, Math.atan2(-dy, dx), Math.max(26, Math.hypot(dx, dy)), g.kind === "nav" ? C.plan : C.pose, 3);
    }
    const m = v.scale < 25 ? 5 : 1;
    ctx.fillStyle = "#e5ecf6"; ctx.fillRect(14, 14, m * v.scale, 3);
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif"; ctx.fillText(`${m} m`, 14, 32);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fit = useCallback(() => {
    const m = live.current.map, c = cv.current;
    if (!m || !c) return;
    const { w, h } = size();
    const mw = m.width * m.resolution, mh = m.height * m.resolution;
    Object.assign(view.current, { cx: m.origin[0] + mw / 2, cy: m.origin[1] + mh / 2,
      scale: Math.min(w / (mw * 1.15), h / (mh * 1.15)), fitted: true });
    draw();
  }, [draw]);

  // decode the occupancy grid into an offscreen image when a new map arrives
  useEffect(() => {
    if (!map) return;
    const raw = atob(map.data), off = document.createElement("canvas");
    off.width = map.width; off.height = map.height;
    const oc = off.getContext("2d")!, im = oc.createImageData(map.width, map.height);
    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const val = raw.charCodeAt(row * map.width + col);
        const o = ((map.height - 1 - row) * map.width + col) * 4; // grid row 0 is the bottom
        let c: number[];
        if (val === 255) c = [21, 28, 44];
        else if (val >= 65) c = C.occ;
        else { const t = val / 65; c = C.free.map((f, i) => Math.round(f + (C.occ[i] - f) * t * 0.6)); }
        im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
      }
    }
    oc.putImageData(im, 0, 0);
    img.current = off;
    if (!view.current.fitted) fit(); else draw();
  }, [map, fit, draw]);

  // redraw on every state update
  useEffect(() => { draw(); }, [S, stations, layers, follow, draw]);
  useEffect(() => { if (fitSignal) fit(); }, [fitSignal, fit]);
  useEffect(() => {
    if (!zoomSignal?.n) return;
    view.current.scale = Math.min(800, Math.max(4, view.current.scale * zoomSignal.factor));
    draw();
  }, [zoomSignal, draw]);

  // keep the canvas at device resolution
  useEffect(() => {
    const el = wrap.current!, c = cv.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect(), d = devicePixelRatio || 1;
      c.width = Math.max(1, r.width * d); c.height = Math.max(1, r.height * d);
      if (!view.current.fitted) fit(); else draw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, draw]);

  // wheel zoom (non-passive so the page does not scroll)
  useEffect(() => {
    const c = cv.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect(), p: [number, number] = [e.clientX - r.left, e.clientY - r.top];
      const before = toWorld(...p);
      view.current.scale = Math.min(800, Math.max(4, view.current.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const after = toWorld(...p);
      view.current.cx += before[0] - after[0]; view.current.cy += before[1] - after[1];
      draw();
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw]);

  const local = (e: React.PointerEvent): [number, number] => {
    const r = cv.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  return (
    <div ref={wrap} className={`relative min-h-0 overflow-hidden ${className}`}>
      <canvas
        ref={cv}
        className={`absolute inset-0 h-full w-full touch-none ${tool === "pan" || !interactive ? "cursor-grab" : "cursor-crosshair"}`}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          cv.current!.setPointerCapture(e.pointerId);
          const p = local(e);
          const kind: Tool = !interactive || e.button === 1 || e.button === 2 || tool === "pan" ? "pan" : tool;
          drag.current = { kind, start: p, cur: p, world: toWorld(...p), v0: { cx: view.current.cx, cy: view.current.cy } };
          if (kind === "pan" && follow) onFollowChange?.(false);
        }}
        onPointerMove={(e) => {
          const p = local(e), [wx, wy] = toWorld(...p);
          if (interactive) setCoords(`x ${wx.toFixed(2)}  y ${wy.toFixed(2)}`);
          const g = drag.current;
          if (!g) return;
          g.cur = p;
          if (g.kind === "pan") {
            view.current.cx = g.v0.cx - (p[0] - g.start[0]) / view.current.scale;
            view.current.cy = g.v0.cy + (p[1] - g.start[1]) / view.current.scale;
          }
          draw();
        }}
        onPointerUp={() => {
          const g = drag.current;
          drag.current = null;
          draw();
          if (!g || g.kind === "pan") return;
          const dx = g.cur[0] - g.start[0], dy = g.cur[1] - g.start[1];
          const pose = live.current.S?.pose;
          const yaw = Math.hypot(dx, dy) > 8 ? Math.atan2(-dy, dx)
            : pose ? Math.atan2(g.world[1] - pose.y, g.world[0] - pose.x) : 0;
          onPick?.(g.kind, g.world[0], g.world[1], yaw);
        }}
      />
      {!map && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
          <span className="rounded-full border border-ink-600 bg-ink-900/90 px-3 py-1 text-xs text-slate-300">
            No map yet: start mapping or localization in Robot Stack
          </span>
        </div>
      )}
      {interactive && coords && (
        <div className="pointer-events-none absolute right-2.5 top-2.5 rounded-md bg-slate-950/80 px-2 py-1 font-mono text-xs text-slate-400">
          {coords}
        </div>
      )}
    </div>
  );
}

function arrow(ctx: CanvasRenderingContext2D, sx: number, sy: number, yaw: number, len: number, color: string, width = 2) {
  const ex = sx + Math.cos(yaw) * len, ey = sy - Math.sin(yaw) * len, a = Math.atan2(ey - sy, ex - sx);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ex, ey);
  ctx.lineTo(ex - 9 * Math.cos(a - 0.45), ey - 9 * Math.sin(a - 0.45));
  ctx.lineTo(ex - 9 * Math.cos(a + 0.45), ey - 9 * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill();
}

/** Nova seen from above, to scale (enlarged when zoomed far out so it stays visible). */
function drawRobot(ctx: CanvasRenderingContext2D, sx: number, sy: number, yaw: number, scale: number, col: string) {
  const { chassis: ch, wheel: wh, caster, lidar } = ROBOT;
  const len = ch.x1 - ch.x0;
  const k = Math.max(scale, 30 / len); // px per metre; at least 30 px long
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-yaw);   // screen y points down
  ctx.scale(k, -k);   // from here on: metres, x forward, y left
  ctx.lineJoin = "round";
  // shadow + footprint glow
  ctx.fillStyle = col + "26";
  ctx.beginPath(); ctx.roundRect(ch.x0 - 0.04, -ch.halfW - 0.05, len + 0.08, 2 * ch.halfW + 0.1, 0.06); ctx.fill();
  // wheels
  ctx.fillStyle = "#0f172a"; ctx.strokeStyle = "#475569"; ctx.lineWidth = 1.2 / k;
  for (const sgn of [1, -1]) {
    ctx.beginPath(); ctx.roundRect(wh.x - wh.r, sgn * wh.y - wh.w / 2, 2 * wh.r, wh.w, 0.006); ctx.fill(); ctx.stroke();
  }
  // chassis with a lighter top edge for a bit of depth
  const g = ctx.createLinearGradient(ch.x0, 0, ch.x1, 0);
  g.addColorStop(0, "#1e293b"); g.addColorStop(1, "#334155");
  ctx.fillStyle = g; ctx.strokeStyle = col; ctx.lineWidth = 2 / k;
  ctx.beginPath(); ctx.roundRect(ch.x0, -ch.halfW, len, 2 * ch.halfW, 0.025); ctx.fill(); ctx.stroke();
  // caster
  ctx.fillStyle = "#64748b"; ctx.beginPath(); ctx.arc(caster.x, 0, 0.018, 0, 7); ctx.fill();
  // lidar puck
  ctx.fillStyle = "#0b1120"; ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1.5 / k;
  ctx.beginPath(); ctx.arc(lidar.x, 0, lidar.r, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#fb7185"; ctx.beginPath(); ctx.arc(lidar.x + lidar.r * 0.55, 0, 0.012, 0, 7); ctx.fill();
  // heading chevron at the front
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(ch.x1 - 0.015, 0); ctx.lineTo(ch.x1 - 0.07, 0.05); ctx.lineTo(ch.x1 - 0.07, -0.05); ctx.closePath(); ctx.fill();
  ctx.restore();
}
