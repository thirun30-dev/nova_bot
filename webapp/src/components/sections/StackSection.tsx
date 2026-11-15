"use client";

import { useEffect, useRef, useState } from "react";
import { getJson } from "@/lib/api";
import type { ServiceName, ServiceState } from "@/lib/types";
import { Icon } from "../icons";
import { useRobot } from "../RobotProvider";
import { Button, Card, cx, Dot, Empty, type Tone } from "../ui";

const STATE_TXT: Record<ServiceState, string> = { stopped: "stopped", starting: "starting…", running: "running",
  stopping: "stopping…", failed: "failed", external: "running (external)" };
const TONE: Record<ServiceState, Tone> = { stopped: "off", starting: "busy", running: "ok", stopping: "busy", failed: "bad", external: "info" };
const ORDER: ServiceName[] = ["robot", "slam", "localization", "navigation"];

function pref(k: string, v?: string): string | null {
  try {
    if (v === undefined) return localStorage.getItem("nova_" + k);
    localStorage.setItem("nova_" + k, v);
  } catch { /* private mode */ }
  return null;
}

/** World / map / headless choices, remembered per browser. */
export function useStackChoices() {
  const { options } = useRobot();
  // explicit picks in this session; otherwise the remembered pick, else a default.
  // (options only exist in the browser, so reading localStorage here cannot break hydration)
  const [pick, setPick] = useState<{ world?: string; map?: string; headless?: boolean }>({});
  const valid = <T,>(v: T | null | undefined, ok: (v: T) => boolean) => (v != null && ok(v) ? v : undefined);
  const names = options?.maps.map((m) => m.name) ?? [];
  const newest = options?.maps.slice().sort((a, b) => b.modified.localeCompare(a.modified))[0]?.name ?? "";
  const world = !options ? "" : valid(pick.world, (w) => options.worlds.includes(w))
    ?? valid(pref("world"), (w) => options.worlds.includes(w)) ?? options.default_world;
  const map = !options ? "" : valid(pick.map, (m) => names.includes(m))
    ?? valid(pref("map"), (m) => names.includes(m)) ?? newest;
  const headless = !options ? false : pick.headless ?? pref("headless") === "1";

  return {
    world, map, headless,
    setWorld: (v: string) => { pref("world", v); setPick((p) => ({ ...p, world: v })); },
    setMap: (v: string) => { pref("map", v); setPick((p) => ({ ...p, map: v })); },
    setHeadless: (v: boolean) => { pref("headless", v ? "1" : "0"); setPick((p) => ({ ...p, headless: v })); },
    body: (extra: Record<string, unknown>) => ({ world, map, headless, ...extra }),
  };
}

export function Presets({ choices }: { choices: ReturnType<typeof useStackChoices> }) {
  const { act, toast } = useRobot();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <button
        onClick={() => act("stack/preset", choices.body({ preset: "mapping" }), "Starting robot, SLAM and Nav2…")}
        className="group rounded-xl border border-accent/60 bg-gradient-to-br from-blue-950 to-ink-850 p-4 text-left transition-colors hover:border-accent">
        <div className="flex items-center gap-2 text-base font-semibold"><Icon name="map" className="size-5 text-accent-2" /> Map a new area</div>
        <p className="mt-1 text-xs text-slate-400">Robot + SLAM + Nav2. Drive or click goals to explore, then save the map.</p>
      </button>
      <button
        onClick={() => choices.map
          ? act("stack/preset", choices.body({ preset: "navigation" }), `Starting robot, AMCL on ${choices.map} and Nav2…`)
          : toast("No saved map yet: map an area and save it first", true)}
        className="group rounded-xl border border-emerald-700/60 bg-gradient-to-br from-emerald-950 to-ink-850 p-4 text-left transition-colors hover:border-emerald-500">
        <div className="flex items-center gap-2 text-base font-semibold"><Icon name="compass" className="size-5 text-emerald-300" /> Work on a saved map</div>
        <p className="mt-1 text-xs text-slate-400">Robot + AMCL localization on <b className="text-slate-200">{choices.map || "—"}</b> + Nav2, ready for missions.</p>
      </button>
    </div>
  );
}

export function Choices({ choices }: { choices: ReturnType<typeof useStackChoices> }) {
  const { options } = useRobot();
  const sim = options?.robot_launch === "sim";
  const sel = "w-full rounded-lg border border-ink-600 bg-ink-950 px-2.5 py-2 text-sm disabled:opacity-50";
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {sim && (
        <label className="text-xs text-slate-400">Gazebo world
          <select className={cx(sel, "mt-1")} value={choices.world} onChange={(e) => choices.setWorld(e.target.value)}>
            {options!.worlds.map((w) => <option key={w}>{w}</option>)}
          </select>
        </label>
      )}
      <label className="text-xs text-slate-400">Saved map (for localization)
        <select className={cx(sel, "mt-1")} value={choices.map} disabled={!options?.maps.length}
          onChange={(e) => choices.setMap(e.target.value)}>
          {!options?.maps.length && <option value="">no saved maps yet</option>}
          {options?.maps.map((m) => <option key={m.name} value={m.name}>{m.name} · {m.modified}</option>)}
        </select>
      </label>
      {sim && (
        <label className="flex items-center gap-2 self-end pb-2 text-xs text-slate-300">
          <input type="checkbox" checked={choices.headless} onChange={(e) => choices.setHeadless(e.target.checked)} className="size-4 accent-blue-500" />
          Headless sim (no Gazebo window)
        </label>
      )}
    </div>
  );
}

function LogViewer({ service, onClose }: { service: ServiceName; onClose: () => void }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const j = await getJson<{ lines: string[] }>("stack/log", { service });
      if (!alive) return;
      const el = ref.current;
      const atEnd = !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
      setLines(j?.lines ?? []);
      if (atEnd) requestAnimationFrame(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; });
    };
    load();
    const t = setInterval(load, 1500);
    return () => { alive = false; clearInterval(t); };
  }, [service]);
  return (
    <Card title={`Output · ${service}`} right={<Button size="sm" variant="ghost" onClick={onClose}><Icon name="x" className="size-3.5" />Close</Button>} bodyClass="p-0">
      <pre ref={ref} className="h-80 overflow-auto whitespace-pre-wrap break-words bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
        {lines === null ? "Loading…" : lines.length ? lines.join("\n") : `(no output: ${service} was not started from this page)`}
      </pre>
    </Card>
  );
}

export default function StackSection() {
  const { state: S, options, act } = useRobot();
  const choices = useStackChoices();
  const [logSvc, setLogSvc] = useState<ServiceName | null>(null);
  const st = S?.stack;

  if (options && !options.enabled) return <Empty>Robot stack control is disabled on this robot (stack_control:=false).</Empty>;

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <Card title="Quick start">
        <Presets choices={choices} />
        <div className="mt-4"><Choices choices={choices} /></div>
      </Card>

      <Card title="Services" right={
        <Button size="sm" variant="danger" onClick={() => confirm("Stop every launch started from this page (Nav2, SLAM/AMCL, robot)?") && act("stack/stop", { service: "all" })}>
          <Icon name="stop" className="size-3.5" /> Stop all
        </Button>}>
        {!st ? <Empty>Waiting for the robot…</Empty> : (
          <ul className="divide-y divide-ink-700">
            {ORDER.filter((n) => st.services[n].available).map((name) => {
              const v = st.services[name];
              const alive = v.state === "running" || v.state === "starting";
              const noMap = name === "localization" && !options?.maps.length;
              const up = v.uptime != null ? ` · up ${v.uptime < 90 ? `${v.uptime} s` : `${Math.round(v.uptime / 60)} min`}` : "";
              return (
                <li key={name} className="flex flex-wrap items-center gap-3 py-3">
                  <Dot tone={TONE[v.state]} />
                  <div className="min-w-40 flex-1">
                    <div className="font-medium">{v.label}</div>
                    <div className="truncate text-xs text-slate-400">
                      {v.state === "failed" ? `exited with code ${v.rc}: see output`
                        : v.state === "external" ? "started outside the dashboard"
                        : (v.desc || "not running") + up}
                    </div>
                  </div>
                  <span className="w-32 text-right text-[11px] uppercase tracking-wide text-slate-400">{STATE_TXT[v.state]}</span>
                  <Button size="sm" variant={alive ? "danger" : "primary"}
                    disabled={v.state === "stopping" || v.state === "external" || (!alive && noMap)}
                    title={noMap ? "Save a map first" : undefined}
                    onClick={() => alive ? act("stack/stop", { service: name }) : act("stack/start", choices.body({ service: name }), `Starting ${v.label}…`)}>
                    <Icon name={alive ? "stop" : "play"} className="size-3.5" />{alive ? "Stop" : "Start"}
                  </Button>
                  <Button size="sm" variant={logSvc === name ? "active" : "default"} onClick={() => setLogSvc(logSvc === name ? null : name)}>
                    <Icon name="logs" className="size-3.5" />Output
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">
          SLAM and localization are exclusive: starting one stops the other, and switching to localization keeps the robot&apos;s current pose.
          Stopping the robot also stops everything above it. Launches started here stop when the dashboard exits.
        </p>
      </Card>

      {logSvc && <LogViewer service={logSvc} onClose={() => setLogSvc(null)} />}
    </div>
  );
}
