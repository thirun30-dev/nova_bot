"use client";

import { useState } from "react";
import { Icon } from "../icons";
import MapView from "../MapView";
import { useRobot } from "../RobotProvider";
import { Button, Card, cx, deg, Empty } from "../ui";
import { NavStatus } from "../widgets";

export default function MissionsSection() {
  const { state: S, stations, act, toast } = useRobot();
  const [rawQueue, setQueue] = useState<string[]>([]);
  const [loop, setLoop] = useState(false);
  const mission = S?.mission;
  const inMap = S?.pose?.frame === "map";

  // queued stations that were deleted meanwhile drop out
  const queue = rawQueue.filter((id) => stations.some((s) => s.id === id));

  const name = (id: string) => stations.find((s) => s.id === id)?.name ?? id;

  const addHere = async () => {
    const n = prompt("Name for a station at the robot's current position:", `Station ${stations.length + 1}`);
    if (n) await act("stations", { action: "add", name: n }, `Station "${n}" added`);
  };

  const start = async () => {
    if (!queue.length) return toast("Add stations to the mission first", true);
    if (await act("mission", { stations: queue, loop }, "Mission started")) setQueue([]);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Stations" right={
          <Button size="sm" onClick={addHere} disabled={!inMap} title={inMap ? "Save the robot's current map position" : "Needs SLAM or localization running"}>
            <Icon name="pin" className="size-3.5" /> Add station here
          </Button>}>
          {!stations.length ? <Empty>No stations yet. Drive the robot to a spot and press “Add station here”.</Empty> : (
            <ul className="divide-y divide-ink-700">
              {stations.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-950 text-violet-300"><Icon name="pin" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="font-mono text-xs text-slate-400">({s.x.toFixed(2)}, {s.y.toFixed(2)}) · {Math.round(deg(s.yaw))}°</div>
                  </div>
                  <Button size="sm" variant="primary" onClick={() => act("goal", { station: s.id }, `Heading to ${s.name}`)}>
                    <Icon name="play" className="size-3" />Go
                  </Button>
                  <Button size="sm" title="Add to the mission" onClick={() => setQueue((q) => [...q, s.id])}>
                    <Icon name="plus" className="size-3.5" />Queue
                  </Button>
                  <Button size="sm" variant="ghost" title="Delete station"
                    onClick={() => confirm(`Delete station "${s.name}"?`) && act("stations", { action: "delete", id: s.id }, "Station deleted")}>
                    <Icon name="x" className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">Stations are saved on the robot (stations.yaml next to the maps).</p>
        </Card>
        <Card title="Station map" bodyClass="p-0">
          <MapView interactive={false} className="h-80" layers={{ scan: false, plan: true, stations: true, grid: true }} />
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card title="Build a mission">
          <div className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-lg bg-ink-800 p-2">
            {!queue.length && <span className="px-1 text-xs text-slate-400">Queue stations with “Queue”, in visiting order.</span>}
            {queue.map((id, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-blue-950 py-0.5 pl-2 pr-1 text-xs text-blue-100">
                {i + 1}. {name(id)}
                <button aria-label="Remove" className="rounded px-1 text-blue-300 hover:bg-blue-900" onClick={() => setQueue(queue.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={start} disabled={!queue.length}><Icon name="play" className="size-3.5" />Start mission</Button>
            <Button onClick={() => setQueue([])} disabled={!queue.length}>Clear</Button>
            <label className="ml-auto inline-flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} className="accent-blue-500" />
              <Icon name="loop" className="size-3.5" /> Loop forever
            </label>
          </div>
        </Card>
        <Card title="Running now">
          <NavStatus />
          {mission?.active && (
            <p className={cx("mt-3 text-xs text-slate-400")}>{mission.queue.length} stop{mission.queue.length === 1 ? "" : "s"} left{mission.loop ? ", then repeats" : ""}.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
