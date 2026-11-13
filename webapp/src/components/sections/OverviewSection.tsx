"use client";

import Link from "next/link";
import type { ServiceName } from "@/lib/types";
import { Icon } from "../icons";
import MapView from "../MapView";
import { useRobot } from "../RobotProvider";
import { Card, cx, Dot } from "../ui";
import { EventLog, NavStatus, RobotStats, SpeedSpark } from "../widgets";
import { Presets, useStackChoices } from "./StackSection";

const ORDER: ServiceName[] = ["robot", "slam", "localization", "navigation"];

export default function OverviewSection() {
  const { state: S } = useRobot();
  const choices = useStackChoices();
  const nothingRunning = S && ORDER.every((n) => ["stopped", "failed"].includes(S.stack.services[n].state));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-4">
        {nothingRunning && S?.stack.enabled && (
          <Card title="Get started">
            <Presets choices={choices} />
            <p className="mt-3 text-xs text-slate-400">
              World, saved map and headless options are in <Link href="/stack/" className="text-accent-2 underline-offset-2 hover:underline">Robot Stack</Link>.
            </p>
          </Card>
        )}
        <Card title="Live map" right={<Link href="/map/" className="inline-flex items-center gap-1 text-xs text-accent-2 hover:underline">Open Map &amp; Navigate <Icon name="right" className="size-3" /></Link>} bodyClass="p-0">
          <MapView interactive={false} className="h-[26rem]" />
        </Card>
        <Card title="Robot">
          <RobotStats />
          <SpeedSpark className="mt-3 h-14" />
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card title="Robot stack" right={<Link href="/stack/" className="text-xs text-accent-2 hover:underline">Manage</Link>}>
          <ul className="space-y-2">
            {ORDER.map((n) => {
              const v = S?.stack.services[n];
              if (v && !v.available) return null;
              const tone = !v ? "off" : v.state === "running" ? "ok" : v.state === "external" ? "info"
                : v.state === "failed" ? "bad" : ["starting", "stopping"].includes(v.state) ? "busy" : "off";
              return (
                <li key={n} className="flex items-center gap-2.5 rounded-lg bg-ink-800 px-3 py-2">
                  <Dot tone={tone} />
                  <span className="flex-1">{v?.label ?? n}</span>
                  <span className={cx("text-xs", v?.state === "running" ? "text-emerald-300" : "text-slate-400")}>{v?.state ?? "–"}</span>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Navigation"><NavStatus /></Card>
        <Card title="Recent events" right={<Link href="/system/" className="text-xs text-accent-2 hover:underline">All</Link>}>
          <EventLog limit={12} className="max-h-72" />
        </Card>
      </div>
    </div>
  );
}
