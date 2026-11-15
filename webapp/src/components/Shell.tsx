"use client";

// App frame: section navigation (sidebar on desktop, bottom tabs on phones), the live
// status bar with the always-visible E-STOP, the E-stop banner and toasts.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "./icons";
import { useRobot } from "./RobotProvider";
import { cx, Dot } from "./ui";

export const SECTIONS: { href: string; label: string; icon: IconName; blurb: string }[] = [
  { href: "/", label: "Overview", icon: "overview", blurb: "Status at a glance" },
  { href: "/map/", label: "Map & Navigate", icon: "map", blurb: "Send goals, set pose" },
  { href: "/drive/", label: "Drive", icon: "drive", blurb: "Manual control + camera" },
  { href: "/stack/", label: "Robot Stack", icon: "stack", blurb: "Start mapping / localization" },
  { href: "/missions/", label: "Missions", icon: "missions", blurb: "Stations and tasks" },
  { href: "/system/", label: "System", icon: "system", blurb: "Health and event log" },
];

const MODE: Record<string, string> = { slam: "SLAM mapping", localization: "Localization", odometry: "Odometry only" };

function isActive(path: string, href: string) {
  const p = path.endsWith("/") ? path : path + "/";
  return href === "/" ? p === "/" : p.startsWith(href);
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const { state: S, conn, toasts, toggleEstop } = useRobot();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const estop = !!S?.estop;
  const bt = S?.lifecycle.bt_navigator;
  const nav2Tone = !S ? "off" : S.nav2_ready && (!bt || bt === "active") ? "ok" : S.nav2_ready ? "warn" : "bad";
  const connTone = conn === "connected" ? "ok" : conn === "stale" ? "warn" : conn === "connecting" ? "busy" : "bad";
  const connText = { connected: "Connected", stale: "Stale", connecting: "Connecting…", offline: "Reconnecting…" }[conn];

  return (
    <div className="flex min-h-dvh">
      {/* sidebar */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-ink-700 bg-ink-900 transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-base font-bold text-white">H</div>
          <div className="min-w-0">
            <div className="truncate font-semibold">{S?.robot ?? "Nova AMR"}</div>
            <div className="text-xs text-slate-400">Warehouse robot control</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {SECTIONS.map((s) => {
            const active = isActive(path, s.href);
            return (
              <Link key={s.href} href={s.href} onClick={() => setOpen(false)}
                className={cx(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  active ? "bg-blue-950/80 text-blue-100 ring-1 ring-accent/50" : "text-slate-300 hover:bg-ink-800",
                )}>
                <Icon name={s.icon} className={cx("size-5", active ? "text-accent-2" : "text-slate-400")} />
                <span className="min-w-0">
                  <span className="block font-medium">{s.label}</span>
                  <span className="block truncate text-xs text-slate-500">{s.blurb}</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1.5 border-t border-ink-700 px-5 py-4 text-xs text-slate-400">
          <div className="flex items-center gap-2"><Dot tone={connTone} />{connText}</div>
          <div>ROS time <span className="font-mono tabular text-slate-300">{S ? S.ros_time.toFixed(1) + " s" : "–"}</span></div>
          <div className="text-slate-500">Space = E-STOP</div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* status bar */}
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-ink-700 bg-ink-900/95 px-4 py-2.5 backdrop-blur">
          <button className="rounded-lg p-1.5 text-slate-300 hover:bg-ink-800 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Icon name="menu" className="size-5" />
          </button>
          <h1 className="mr-2 text-base font-semibold">
            {SECTIONS.find((s) => isActive(path, s.href))?.label ?? "Nova"}
          </h1>
          <div className="order-last flex w-full flex-wrap items-center gap-1.5 text-xs lg:order-none lg:w-auto lg:gap-2">
            <Pill><Dot tone={connTone} /><b>{connText}</b></Pill>
            <Pill>Mode <b>{S ? MODE[S.mode] : "–"}</b></Pill>
            <Pill><Dot tone={nav2Tone} />Nav2 <b>{S ? (S.nav2_ready ? bt || "ready" : "offline") : "–"}</b></Pill>
            {S?.stack.busy && <Pill><Dot tone="busy" /><b className="max-w-56 truncate">{S.stack.busy}</b></Pill>}
          </div>
          <div className="flex-1" />
          <button
            onClick={toggleEstop}
            title="Emergency stop: blocks every velocity source (key: Space)"
            className={cx(
              "rounded-xl border-2 px-4 py-2 text-sm font-extrabold tracking-wide transition-colors sm:px-5",
              estop
                ? "animate-pulse-ring border-white bg-yellow-400 text-black"
                : "border-red-300 bg-red-700 text-white shadow-[0_0_0_3px] shadow-red-950 hover:bg-red-600",
            )}
          >
            {estop ? "RELEASE E-STOP" : "E-STOP"}
          </button>
        </header>
        {estop && (
          <div className="estop-stripes px-4 py-1.5 text-center text-sm font-bold tracking-wide text-white">
            ⚠ EMERGENCY STOP ENGAGED: ALL MOTION BLOCKED
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 pb-24 lg:pb-6">{children}</main>
      </div>

      {/* bottom tabs on phones */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-ink-700 bg-ink-900/95 backdrop-blur lg:hidden">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href}
            className={cx("flex flex-col items-center gap-0.5 py-2 text-[10px]", isActive(path, s.href) ? "text-accent-2" : "text-slate-400")}>
            <Icon name={s.icon} className="size-5" />
            <span className="max-w-full truncate px-1">{s.label.split(" ")[0]}</span>
          </Link>
        ))}
      </nav>

      {/* toasts */}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2 lg:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} role="status"
            className={cx("rounded-lg border bg-ink-800 px-4 py-2.5 text-sm shadow-lg", t.error ? "border-rose-500 text-rose-100" : "border-ink-600")}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-ink-700 bg-ink-850 px-2.5 py-1 text-slate-400 [&_b]:font-semibold [&_b]:text-slate-100">
      {children}
    </span>
  );
}
