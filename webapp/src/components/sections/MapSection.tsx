"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Icon, type IconName } from "../icons";
import MapView, { type Layers, type Tool } from "../MapView";
import { useRobot } from "../RobotProvider";
import { Button, Card, cx } from "../ui";
import { NavStatus, RobotStats } from "../widgets";

// three.js is only downloaded when the 3D view is opened
const Map3D = dynamic(() => import("../Map3D"), {
  ssr: false,
  loading: () => <div className="grid flex-1 place-items-center text-slate-500">Loading 3D view…</div>,
});

const TOOLS: { id: Tool; label: string; icon: IconName; hint: string }[] = [
  { id: "nav", label: "Navigate", icon: "target", hint: "Click: send a Nav2 goal · drag: set the heading" },
  { id: "pose", label: "Set pose", icon: "pin", hint: "Click: set the AMCL pose · drag: set the heading" },
  { id: "pan", label: "Pan", icon: "hand", hint: "Drag to pan · wheel to zoom" },
];

export default function MapSection() {
  const { act, state: S } = useRobot();
  const [tool, setTool] = useState<Tool>("nav");
  const [layers, setLayers] = useState<Layers>({ scan: true, plan: true, stations: true, grid: true });
  const [follow, setFollow] = useState(false);
  const [fitN, setFitN] = useState(0);
  const [zoom, setZoom] = useState({ n: 0, factor: 1 });
  const [view3d, setView3d] = useState(() => {
    // ?view=3d|2d (bookmarkable), else the last choice; this section only renders in the browser
    const q = new URLSearchParams(location.search).get("view");
    if (q === "3d" || q === "2d") return q === "3d";
    try { return localStorage.getItem("nova_map_view") === "3d"; } catch { return false; }
  });
  const setView = (v: boolean) => {
    setView3d(v);
    try { localStorage.setItem("nova_map_view", v ? "3d" : "2d"); } catch { /* ignore */ }
  };

  const saveMap = async () => {
    const name = prompt("Map name (saved with the robot's maps):", "warehouse_map");
    if (!name) return;
    if (await act("save_map", { name }, "Saving map…")) {
      try { localStorage.setItem("nova_map", name.replace(/[^A-Za-z0-9_-]/g, "") || "warehouse_map"); } catch { /* ignore */ }
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="h-[calc(100dvh-9.5rem)] min-h-[28rem]" bodyClass="flex flex-col p-0">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-700 px-3 py-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-ink-600">
            {([false, true] as const).map((v) => (
              <button key={String(v)} onClick={() => setView(v)}
                className={cx("px-2.5 py-1 text-xs font-semibold", view3d === v ? "bg-accent text-white" : "bg-ink-800 text-slate-300 hover:bg-ink-700")}>
                {v ? "3D" : "2D"}
              </button>
            ))}
          </div>
          <span className="mx-1 h-5 w-px bg-ink-700" />
          {!view3d && TOOLS.map((t) => (
            <Button key={t.id} size="sm" variant={tool === t.id ? "active" : "default"} title={t.hint} onClick={() => setTool(t.id)}>
              <Icon name={t.icon} className="size-3.5" />{t.label}
            </Button>
          ))}
          {!view3d && <span className="mx-1 h-5 w-px bg-ink-700" />}
          {!view3d && <Button size="sm" title="Zoom in" onClick={() => setZoom((z) => ({ n: z.n + 1, factor: 1.25 }))}><Icon name="plus" className="size-3.5" /></Button>}
          {!view3d && <Button size="sm" title="Zoom out" onClick={() => setZoom((z) => ({ n: z.n + 1, factor: 0.8 }))}><Icon name="minus" className="size-3.5" /></Button>}
          <Button size="sm" title="Fit the map" onClick={() => { setFollow(false); setFitN((n) => n + 1); }}><Icon name="fit" className="size-3.5" />Fit</Button>
          <Button size="sm" variant={follow ? "active" : "default"} title="Keep the robot centred" onClick={() => setFollow(!follow)}>
            <Icon name="follow" className="size-3.5" />Follow
          </Button>
          <span className="mx-1 h-5 w-px bg-ink-700" />
          {(Object.keys(layers) as (keyof Layers)[]).map((k) => (
            <label key={k} className="inline-flex items-center gap-1 px-1 text-xs capitalize text-slate-400">
              <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} className="accent-blue-500" />
              {k === "scan" ? "lidar" : k === "plan" ? "path" : k}
            </label>
          ))}
          <div className="flex-1" />
          <Button size="sm" onClick={saveMap} disabled={!S || S.map_version === 0} title="Save the current map (nav2 map_saver)">
            <Icon name="save" className="size-3.5" />Save map
          </Button>
        </div>
        {view3d ? <Map3D className="flex-1" follow={follow} layers={layers} fitSignal={fitN} /> : <MapView
          className="flex-1"
          tool={tool} layers={layers} follow={follow} onFollowChange={setFollow}
          fitSignal={fitN} zoomSignal={zoom}
          onPick={(kind, x, y, yaw) => kind === "nav"
            ? act("goal", { x, y, yaw }, `Goal sent: (${x.toFixed(2)}, ${y.toFixed(2)})`)
            : act("initialpose", { x, y, yaw }, "Initial pose set")}
        />}
        <div className={cx("border-t border-ink-700 px-3 py-1.5 text-xs text-slate-400")}>
          {view3d ? "3D view: drag orbits · right-drag pans · wheel zooms · switch to 2D to send goals or set the pose"
            : <>{TOOLS.find((t) => t.id === tool)!.hint} · wheel zooms · right-drag pans</>}
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <Card title="Navigation"><NavStatus /></Card>
        <Card title="Robot" right={S?.pose && <span className="text-xs text-slate-500">frame: {S.pose.frame}</span>}>
          <RobotStats compact />
        </Card>
      </div>
    </div>
  );
}
