"use client";

import { useState } from "react";
import { Icon, type IconName } from "../icons";
import MapView, { type Layers, type Tool } from "../MapView";
import { useRobot } from "../RobotProvider";
import { Button, Card, cx } from "../ui";
import { NavStatus, RobotStats } from "../widgets";

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

  const saveMap = async () => {
    const name = prompt("Map name (saved with the robot's maps):", "warehouse_map");
    if (!name) return;
    if (await act("save_map", { name }, "Saving map…")) {
      try { localStorage.setItem("hiro_map", name.replace(/[^A-Za-z0-9_-]/g, "") || "warehouse_map"); } catch { /* ignore */ }
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="h-[calc(100dvh-9.5rem)] min-h-[28rem]" bodyClass="flex flex-col p-0">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-700 px-3 py-2">
          {TOOLS.map((t) => (
            <Button key={t.id} size="sm" variant={tool === t.id ? "active" : "default"} title={t.hint} onClick={() => setTool(t.id)}>
              <Icon name={t.icon} className="size-3.5" />{t.label}
            </Button>
          ))}
          <span className="mx-1 h-5 w-px bg-ink-700" />
          <Button size="sm" title="Zoom in" onClick={() => setZoom((z) => ({ n: z.n + 1, factor: 1.25 }))}><Icon name="plus" className="size-3.5" /></Button>
          <Button size="sm" title="Zoom out" onClick={() => setZoom((z) => ({ n: z.n + 1, factor: 0.8 }))}><Icon name="minus" className="size-3.5" /></Button>
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
        <MapView
          className="flex-1"
          tool={tool} layers={layers} follow={follow} onFollowChange={setFollow}
          fitSignal={fitN} zoomSignal={zoom}
          onPick={(kind, x, y, yaw) => kind === "nav"
            ? act("goal", { x, y, yaw }, `Goal sent: (${x.toFixed(2)}, ${y.toFixed(2)})`)
            : act("initialpose", { x, y, yaw }, "Initial pose set")}
        />
        <div className={cx("border-t border-ink-700 px-3 py-1.5 text-xs text-slate-400")}>
          {TOOLS.find((t) => t.id === tool)!.hint} · wheel zooms · right-drag pans
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
