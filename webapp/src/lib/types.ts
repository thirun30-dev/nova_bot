// Shapes of the hiro_dashboard.py API (scripts/hiro_dashboard.py).

export type Pose = { x: number; y: number; yaw: number; frame: "map" | "odom" };

export type NavState =
  | "idle" | "sending" | "navigating" | "succeeded" | "failed" | "rejected" | "canceled" | "canceling"
  | string;

export type Nav = {
  state: NavState;
  target: { x: number | null; y: number | null; yaw: number; label: string } | null;
  feedback: { distance_remaining: number; eta: number; navigation_time: number; recoveries: number } | null;
  started: number | null;
  initial_distance: number | null;
  progress?: number;
};

export type ServiceName = "robot" | "slam" | "localization" | "navigation";
export type ServiceState = "stopped" | "starting" | "running" | "stopping" | "failed" | "external";

export type Service = {
  label: string;
  state: ServiceState;
  desc: string;
  uptime: number | null;
  rc: number | null;
  available: boolean;
};

export type EventItem = { seq: number; t: string; level: "info" | "warn" | "error"; text: string };

export type RobotState = {
  robot: string;
  ros_time: number;
  mode: "slam" | "localization" | "odometry";
  estop: boolean;
  pose: Pose | null;
  velocity: { vx: number; wz: number } | null;
  command: { vx: number; wz: number };
  amcl: { std_xy: number; std_yaw_deg: number } | null;
  battery: { percent: number | null; voltage: number } | null;
  nav: Nav;
  nav2_ready: boolean;
  mission: { queue: string[]; loop: boolean; active: boolean };
  lifecycle: Record<string, string | null>;
  health: { node: string; role: string; up: boolean }[];
  map_version: number;
  maps_version: number;
  stations_version: number;
  scan: number[];
  plan: number[];
  camera: boolean;
  events: EventItem[];
  stack: {
    services: Record<ServiceName, Service>;
    busy: string | null;
    robot_launch: "sim" | "real" | "none";
    enabled: boolean;
  };
};

export type Station = { id: string; name: string; x: number; y: number; yaw: number };

export type MapData = {
  version: number;
  width: number;
  height: number;
  resolution: number;
  origin: [number, number, number];
  data: string; // base64, one byte per cell, 255 = unknown
};

export type StackOptions = {
  robot_launch: "sim" | "real" | "none";
  worlds: string[];
  default_world: string;
  maps: { name: string; modified: string }[];
  enabled: boolean;
};

export type ApiResult = { ok?: boolean; message?: string; error?: string };
