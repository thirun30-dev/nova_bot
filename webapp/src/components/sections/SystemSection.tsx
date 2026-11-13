"use client";

import { useRobot } from "../RobotProvider";
import { Card, Stat } from "../ui";
import { EventLog, Health } from "../widgets";

export default function SystemSection() {
  const { state: S, conn, events } = useRobot();
  const warn = events.filter((e) => e.level === "warn").length;
  const err = events.filter((e) => e.level === "error").length;
  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Connection" value={conn} />
        <Stat label="ROS time" value={S ? S.ros_time.toFixed(1) : "–"} unit="s" />
        <Stat label="Robot launch" value={S?.stack.robot_launch ?? "–"} />
        <Stat label="Warnings / errors" value={`${warn} / ${err}`} hint="In this browser session" />
      </div>
      <Card title="Node health"><Health /></Card>
      <Card title="Event log"><EventLog className="max-h-[32rem]" /></Card>
    </div>
  );
}
