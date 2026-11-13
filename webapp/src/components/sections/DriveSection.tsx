"use client";

import { useRobot } from "../RobotProvider";
import { Card, fmt, Stat } from "../ui";
import { Camera, DrivePad, SpeedSpark } from "../widgets";
import MapView from "../MapView";

export default function DriveSection() {
  const { state: S } = useRobot();
  const robotUp = S?.stack.services.robot && ["running", "external"].includes(S.stack.services.robot.state);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card title="Manual drive" right={<span className="text-xs text-slate-500">W A S D / arrow keys</span>}>
          {S && !robotUp && (
            <p className="mb-4 rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              The robot base is not running. Start it in Robot Stack first.
            </p>
          )}
          <DrivePad large />
        </Card>
        <Card title="Motion">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Speed" value={fmt(S?.velocity?.vx)} unit="m/s" />
            <Stat label="Turn rate" value={fmt(S?.velocity?.wz)} unit="rad/s" />
            <Stat label="Command" value={fmt(S?.command.vx)} unit="m/s" hint="What twist_mux sends to the wheels" />
          </div>
          <SpeedSpark className="mt-3 h-20" />
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card title="Camera"><Camera /></Card>
        <Card title="Surroundings" bodyClass="p-0">
          <MapView interactive={false} follow className="h-64" layers={{ scan: true, plan: true, stations: false, grid: true }} />
        </Card>
      </div>
    </div>
  );
}
