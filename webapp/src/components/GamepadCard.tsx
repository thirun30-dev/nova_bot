"use client";

// Drive page: turn the USB gamepad plugged into the robot on/off and show what it is doing.
// The robot runs joy_node + teleop_twist_joy ("joystick" service); twist_mux gives the pad
// priority over the web pad and Nav2, and E-STOP still blocks it.

import { useRobot } from "./RobotProvider";
import { Badge, Button, Card, cx, Dot } from "./ui";

export default function GamepadCard() {
  const { state: S, act } = useRobot();
  const svc = S?.stack.services.joystick;
  const pad = S?.gamepad;
  const st = svc?.state ?? "stopped";
  const on = st === "running" || st === "starting" || st === "external";
  const busy = st === "starting" || st === "stopping";
  const robotUp = S?.stack.services.robot && ["running", "external"].includes(S.stack.services.robot.state);

  const toggle = () =>
    on
      ? act("stack/stop", { service: "joystick" }, "Gamepad control off")
      : act("stack/start", { service: "joystick" }, "Gamepad control starting…");

  const lx = pad?.axes[0] ?? 0;
  const ly = pad?.axes[1] ?? 0;
  const driving = !!(pad?.enable_held || pad?.turbo_held);

  return (
    <Card
      title="Gamepad control"
      right={<Badge state={st}>{st === "external" ? "running" : st}</Badge>}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={on ? "danger" : "primary"} onClick={toggle} disabled={!S || busy || st === "external"}>
          {on ? "Turn off gamepad" : "Use gamepad"}
        </Button>
        {on && (
          <span className="flex items-center gap-2 text-sm">
            <Dot tone={pad?.connected ? (driving ? "ok" : "info") : "warn"} />
            {pad?.connected
              ? <>{pad.name ?? "Gamepad"} · {driving ? (pad.turbo_held ? "driving (turbo)" : "driving") : "hold LB to drive"}</>
              : "No gamepad detected on the robot"}
          </span>
        )}
      </div>

      {on && pad?.connected && (
        <div className="mt-4 flex items-center gap-4">
          <div className="relative size-20 shrink-0 rounded-full border border-ink-600 bg-ink-800" title="Left stick">
            <div
              className={cx("absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full", driving ? "bg-accent" : "bg-slate-500")}
              style={{ left: `${50 - lx * 40}%`, top: `${50 - ly * 40}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pad.buttons.map((b, i) => (
              <span key={i}
                className={cx("grid size-7 place-items-center rounded-md border font-mono text-[11px]",
                  b ? "border-accent bg-blue-950 text-blue-100" : "border-ink-600 text-slate-500")}
                title={i === pad.enable_button ? "drive (deadman)" : i === pad.turbo_button ? "turbo" : `button ${i}`}>
                {i === pad.enable_button ? "LB" : i === pad.turbo_button ? "RB" : i}
              </span>
            ))}
          </div>
        </div>
      )}

      <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-slate-400">
        <li>Hold <b className="text-slate-200">LB</b> and use the left stick (up/down drives, left/right turns). Hold <b className="text-slate-200">RB</b> instead for faster driving. Let go and the robot stops.</li>
        <li>The gamepad overrides the web pad and Nav2 goals while a button is held. E-STOP still blocks it.</li>
        {S && !robotUp && <li className="text-amber-300">The robot base isn&apos;t running. Start it in Robot Stack so the gamepad can move it.</li>}
      </ul>
    </Card>
  );
}
