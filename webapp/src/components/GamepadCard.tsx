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
        <div className="mt-4 space-y-3">
          <Axis label="Forward / back" hint={`left stick, axis ${pad.drive_axis}`} value={pad.drive} active={driving} neg="back" pos="forward" />
          <Axis label="Turn" hint={`right stick, axis ${pad.turn_axis}`} value={-pad.turn} active={driving} neg="left" pos="right" />
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
        <li>Hold <b className="text-slate-200">LB</b>, then push the <b className="text-slate-200">left stick</b> up/down to drive and the <b className="text-slate-200">right stick</b> left/right to turn. Hold <b className="text-slate-200">RB</b> instead for faster driving. Let go and the robot stops.</li>
        <li>The gamepad overrides the web pad and Nav2 goals while a button is held. E-STOP still blocks it.</li>
        {S && !robotUp && <li className="text-amber-300">The robot base isn&apos;t running. Start it in Robot Stack so the gamepad can move it.</li>}
      </ul>
    </Card>
  );
}

/** -1..1 bar from the centre; `value` > 0 fills to the right. */
function Axis({ label, hint, value, active, neg, pos }: {
  label: string; hint: string; value: number; active: boolean; neg: string; pos: string;
}) {
  const v = Math.max(-1, Math.min(1, value));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-400">
        <span>{label} <span className="text-slate-500">({hint})</span></span>
        <span className="font-mono tabular text-slate-300">{v.toFixed(2)}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-ink-800">
        <div className="absolute inset-y-0 left-1/2 w-px bg-ink-600" />
        <div className={cx("absolute inset-y-0 rounded-full", active ? "bg-accent" : "bg-slate-500")}
          style={v >= 0 ? { left: "50%", width: `${v * 50}%` } : { right: "50%", width: `${-v * 50}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-500"><span>{neg}</span><span>{pos}</span></div>
    </div>
  );
}
