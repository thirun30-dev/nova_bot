#!/usr/bin/env python3
"""Nova AMR web dashboard: a ROS 2 node with a built-in HTTP server.

    ros2 run nova_bot nova_dashboard.py                      # http://localhost:8080
    ros2 run nova_bot nova_dashboard.py --ros-args -p host:=0.0.0.0 -p token:=secret

No rosbridge needed. The browser gets live state over Server-Sent Events
(/api/stream) and controls the robot through small JSON POST endpoints:

  GET  /api/stream        robot state, ~5 Hz (SSE)
  GET  /api/map           occupancy grid (fetched when map_version changes)
  GET  /api/camera.mjpg   camera as MJPEG (from /camera/image_raw/compressed)
  GET  /api/stations      warehouse stations
  POST /api/goal          {"x":..,"y":..,"yaw":..} or {"station":"rack_a"}
  POST /api/mission       {"stations":["receiving","rack_a","dock"], "loop":false}
  POST /api/cancel
  POST /api/cmd_vel       {"vx":..,"wz":..}  (send ~10 Hz while driving)
  POST /api/estop         {"on":true|false}
  POST /api/initialpose   {"x":..,"y":..,"yaw":..}
  POST /api/save_map      {"name":"warehouse"}
  POST /api/stations      {"action":"add","name":"Dock 2"[,"x","y","yaw"]} (default: robot pose)
                          {"action":"delete","id":"dock_2"}

Robot stack (start/stop ROS launch files from the browser; whitelisted, never arbitrary commands):

  GET  /api/stack/options  robot kind, worlds, saved maps
  GET  /api/stack/log?service=slam   last output lines of one launch
  POST /api/stack/start    {"service":"robot|slam|localization|navigation",
                            "world":"obstacles.world","headless":false,"map":"my_map_v2",
                            "x":..,"y":..,"yaw":..}   (pose: AMCL start pose, localization only)
  POST /api/stack/stop     {"service":"slam"}  or  {"service":"all"}
  POST /api/stack/preset   {"preset":"mapping|navigation", ...same options}
      mapping    = robot + SLAM + Nav2       (explore and build a map)
      navigation = robot + AMCL on a saved map + Nav2   (do warehouse tasks)

Launches started here are stopped when the dashboard exits. Run the dashboard on its own
(ros2 launch nova_bot web_control.launch.py) and drive everything from the page.

Safety: the e-stop is a twist_mux lock (priority 255), so it blocks every
velocity source, Nav2 included. Dashboard teleop goes to its own mux input
(priority 50: above Nav2, below the gamepad). Bind to 127.0.0.1 unless the
network is trusted, and set a token when exposing it.
"""
import base64
import collections
import ctypes
import json
import math
import os
import queue
import re
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import rclpy
import yaml
from action_msgs.msg import GoalStatus, GoalStatusArray
from ament_index_python.packages import get_package_share_directory
from geometry_msgs.msg import PoseWithCovarianceStamped, PoseStamped, TwistStamped
from action_msgs.srv import CancelGoal
from lifecycle_msgs.srv import GetState
from nav2_msgs.action import NavigateToPose
from nav_msgs.msg import OccupancyGrid, Odometry, Path
from rclpy.action import ActionClient
from rclpy.clock import Clock, ClockType
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import (DurabilityPolicy, QoSProfile, ReliabilityPolicy,
                       qos_profile_sensor_data)
from rclpy.time import Time
from sensor_msgs.msg import BatteryState, CompressedImage, LaserScan
from std_msgs.msg import Bool
from tf2_ros import Buffer, TransformListener

MAX_VX, MAX_WZ = 0.5, 1.5
STATUS = {GoalStatus.STATUS_SUCCEEDED: 'succeeded', GoalStatus.STATUS_ABORTED: 'failed',
          GoalStatus.STATUS_CANCELED: 'canceled'}

# node name -> what it is, for the health panel
HEALTH = [
    ('controller_manager', 'ros2_control'),
    ('diff_cont', 'diff drive controller'),
    ('robot_state_publisher', 'robot description / TF'),
    ('twist_mux', 'velocity mux + e-stop'),
    ('ros_gz_bridge', 'Gazebo bridge'),
    ('slam_toolbox', 'SLAM'),
    ('amcl', 'AMCL localization'),
    ('map_server', 'map server'),
    ('planner_server', 'Nav2 planner'),
    ('controller_server', 'Nav2 controller'),
    ('bt_navigator', 'Nav2 behaviour tree'),
]


# Robot stack services: name -> (label, node whose presence proves it is up)
SERVICES = {
    'robot': ('Robot base', 'diff_cont'),
    'slam': ('Mapping (SLAM)', 'slam_toolbox'),
    'localization': ('Localization (AMCL)', 'amcl'),
    'navigation': ('Navigation (Nav2)', 'bt_navigator'),
}
# Line a launch prints once it is fully up (more exact than the node merely existing).
READY_LINE = {'robot': 'Configured and activated diff_cont',
              'localization': 'Managed nodes are active',
              'navigation': 'Managed nodes are active'}
EXCLUSIVE = {'slam': 'localization', 'localization': 'slam'}
ROBOT_ARG = re.compile(r'^(serial_port|baud_rate|enc_counts_per_rev|lidar|lidar_port|lidar_baud|'
                       r'lidar_scan_mode|camera|joystick):=[A-Za-z0-9_./:+-]*$')
DEPENDENTS = {'robot': ['navigation', 'slam', 'localization']}   # stopped before the robot
PRESETS = {'mapping': ['robot', 'slam', 'navigation'],
           'navigation': ['robot', 'localization', 'navigation']}
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
NAME_OK = re.compile(r'^[A-Za-z0-9_.-]+$')


def _die_with_dashboard():
    """Runs in the child before exec: SIGTERM it if the dashboard dies (even on SIGKILL)."""
    try:
        ctypes.CDLL('libc.so.6', use_errno=True).prctl(1, signal.SIGTERM)  # PR_SET_PDEATHSIG
    except Exception:
        pass


class Managed:
    """One `ros2 launch` started from the dashboard, in its own process group."""

    def __init__(self, name, cmd, desc):
        self.name, self.cmd, self.desc = name, cmd, desc
        self.ready_line, self.ready = READY_LINE.get(name), False
        self.log = collections.deque(maxlen=500)
        self.started, self.ended, self.rc, self.stopping = time.time(), None, None, False
        env = dict(os.environ, PYTHONUNBUFFERED='1', RCUTILS_COLORIZED_OUTPUT='0')
        self.log.append('$ ' + ' '.join(cmd))
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     stdin=subprocess.DEVNULL, text=True, bufsize=1,
                                     errors='replace', env=env, start_new_session=True,
                                     preexec_fn=_die_with_dashboard)
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.proc.stdout:
            line = ANSI.sub('', line.rstrip())
            if self.ready_line and not self.ready and self.ready_line in line:
                self.ready = True
            self.log.append(line)
        self.rc = self.proc.wait()
        self.ended = time.time()
        self.log.append(f'[process exited with code {self.rc}]')

    @property
    def alive(self):
        return self.proc.poll() is None

    def _group_alive(self):
        try:
            os.killpg(self.proc.pid, 0)
            return True
        except (ProcessLookupError, PermissionError):
            return False

    def stop(self, grace=15.0):
        """SIGINT to `ros2 launch` only, so it shuts its nodes down in order. (Signalling the
        whole group makes every node get SIGINT twice, and nodes that die on the second one
        never leave the DDS graph.) Escalate to the whole group if anything lingers."""
        self.stopping = True
        for sig, wait, group in ((signal.SIGINT, grace, False), (signal.SIGTERM, 5.0, True),
                                 (signal.SIGKILL, 5.0, True)):
            if not self.alive and not self._group_alive():
                return
            try:
                if group or not self.alive:
                    os.killpg(self.proc.pid, sig)
                else:
                    os.kill(self.proc.pid, sig)
            except ProcessLookupError:
                if not self._group_alive():
                    return
            end = time.time() + wait
            while time.time() < end and (self.alive or self._group_alive()):
                time.sleep(0.2)


class Stack:
    """Starts/stops the whitelisted launch files. All Popen calls run on one long-lived
    worker thread: PR_SET_PDEATHSIG fires when the *thread* that forked exits, so the
    short-lived HTTP request threads must never spawn children."""

    def __init__(self, node):
        self.node = node
        self.procs = {}
        self.jobs = queue.Queue()
        self.abort = threading.Event()
        self.busy = None            # what the worker is doing, for the UI
        self.closed = False
        threading.Thread(target=self._work, daemon=True).start()

    # ---- options ----
    @property
    def kind(self):
        return self.node.get_parameter('robot_launch').value     # sim | real | none

    def worlds(self):
        d = os.path.join(self.node.share, 'worlds')
        return sorted(f for f in os.listdir(d) if f.endswith(('.world', '.sdf')))

    def maps(self):
        d = self.node.get_parameter('map_dir').value
        out = []
        if not os.path.isdir(d):
            return out
        for f in sorted(os.listdir(d)):
            if not f.endswith('.yaml'):
                continue
            try:
                with open(os.path.join(d, f)) as fh:
                    y = yaml.safe_load(fh)
            except Exception:
                continue
            if isinstance(y, dict) and 'image' in y:
                out.append({'name': f[:-5], 'modified': time.strftime(
                    '%Y-%m-%d %H:%M', time.localtime(os.path.getmtime(os.path.join(d, f))))})
        return out

    def options(self):
        return {'robot_launch': self.kind, 'worlds': self.worlds(),
                'default_world': self.node.get_parameter('default_world').value,
                'maps': self.maps(), 'enabled': self.node.get_parameter('stack_control').value}

    def prepare(self, name, o):
        """Validate options in the request thread; returns (cmd, desc). Raises ValueError."""
        if not self.node.get_parameter('stack_control').value:
            raise ValueError('stack control is disabled (stack_control:=false)')
        sim = 'true' if self.node.get_parameter('use_sim_time').value else 'false'
        base = ['ros2', 'launch', 'nova_bot']
        if name == 'robot':
            if self.kind == 'sim':
                world = str(o.get('world') or self.node.get_parameter('default_world').value)
                if world not in self.worlds():
                    raise ValueError(f'unknown world {world!r}')
                headless = 'true' if o.get('headless') else 'false'
                return (base + ['launch_sim.launch.py',
                                'world:=' + os.path.join(self.node.share, 'worlds', world),
                                'headless:=' + headless],
                        f'Gazebo sim · {world}' + (' · headless' if o.get('headless') else ''))
            if self.kind == 'real':
                extra = self.robot_args()
                ports = [a.split(':=', 1)[1] for a in extra
                         if a.startswith(('serial_port:=', 'lidar_port:='))]
                return (base + ['launch_robot.launch.py'] + extra,
                        'real hardware' + (' · ' + ', '.join(ports) if ports else ''))
            raise ValueError('robot base is brought up outside the dashboard (robot_launch:=none)')
        if name == 'slam':
            return base + ['slam.launch.py', 'use_sim_time:=' + sim], 'slam_toolbox, online async'
        if name == 'localization':
            m = str(o.get('map') or '')
            if not NAME_OK.match(m) or m not in [x['name'] for x in self.maps()]:
                raise ValueError(f'unknown map {m!r}: save one first' if m else 'choose a saved map')
            path = os.path.join(self.node.get_parameter('map_dir').value, m + '.yaml')
            return (base + ['localization.launch.py', 'map:=' + path, 'use_sim_time:=' + sim],
                    f'AMCL on {m}')
        if name == 'navigation':
            return base + ['navigation.launch.py', 'use_sim_time:=' + sim], 'Nav2'
        raise ValueError(f'unknown service {name!r}')

    def robot_args(self):
        """robot_args parameter ('serial_port:=/dev/ttyUSB0 lidar:=true ...'), limited to
        launch_robot.launch.py's own arguments and plain values."""
        out = []
        for a in self.node.get_parameter('robot_args').value.split():
            m = ROBOT_ARG.match(a)
            if not m:
                raise ValueError(f'bad robot_args entry {a!r}')
            out.append(a)
        return out

    @staticmethod
    def start_pose(o):
        if all(k in o and o[k] is not None for k in ('x', 'y')):
            return float(o['x']), float(o['y']), float(o.get('yaw') or 0.0)
        return None

    # ---- requests (from HTTP threads) ----
    def request_start(self, name, o):
        cmd, desc = self.prepare(name, o)
        self.abort.clear()
        self.jobs.put((self._start, (name, cmd, desc, self.start_pose(o))))
        return True, f'starting {SERVICES[name][0]}'

    def request_stop(self, name):
        if name != 'all' and name not in SERVICES:
            raise ValueError(f'unknown service {name!r}')
        self.abort.set()            # interrupt a preset that is waiting on a step
        self.jobs.put((self._stop_all if name == 'all' else self._stop, (name,) if name != 'all' else ()))
        return True, 'stopping'

    def request_preset(self, preset, o):
        if preset not in PRESETS:
            raise ValueError(f'unknown preset {preset!r}')
        steps = [(n, *self.prepare(n, o)) for n in PRESETS[preset]
                 if not (n == 'robot' and self.kind == 'none')]
        self.abort.clear()
        self.jobs.put((self._preset, (preset, steps, self.start_pose(o))))
        return True, f'{preset} preset started'

    # ---- worker ----
    def _work(self):
        while True:
            fn, args = self.jobs.get()
            if fn is None:
                return
            try:
                fn(*args)
            except Exception as e:      # keep the worker alive whatever happens
                self.node.event('error', f'Robot stack: {e}')
            finally:
                self.busy = None

    def ours(self, name):
        p = self.procs.get(name)
        return p is not None and p.alive

    def up(self, name):
        return SERVICES[name][1] in self.node.nodes

    def is_ready(self, name):
        """Our launch of `name` is up: its ready line, else its probe node in the graph."""
        p = self.procs.get(name)
        if p is not None and p.alive and p.ready_line:
            return p.ready
        node_name = SERVICES[name][1]
        if node_name not in self.node.nodes:
            return False
        lc = self.node.lifecycle.get(node_name) if node_name in self.node.state_clients else 'n/a'
        return lc in ('active', 'n/a')

    def _start(self, name, cmd, desc, pose=None):
        label = SERVICES[name][0]
        if self.ours(name):
            self.node.event('info', f'{label} is already running')
            return True
        if self.up(name):
            self.node.event('warn', f'{label} is already running outside the dashboard')
            return True
        other = EXCLUSIVE.get(name)
        if other and self.up(other) and not self.ours(other):
            self.node.event('error', f'Cannot start {label}: {SERVICES[other][0]} is running '
                                     'outside the dashboard; stop it there first')
            return False
        if name == 'localization' and pose is None:
            # switching from SLAM: the SLAM pose is the best AMCL start guess
            p = self.node.robot_pose()
            pose = (p['x'], p['y'], p['yaw']) if p and p['frame'] == 'map' else (0.0, 0.0, 0.0)
        if other and self.ours(other):
            self._stop(other)
        self.busy = f'starting {label}'
        self.procs[name] = Managed(name, cmd, desc)
        self.node.event('info', f'Starting {label} ({desc})')
        if name == 'localization':
            threading.Thread(target=self._initial_pose, args=(self.procs[name], pose),
                             daemon=True).start()
        return True

    def _initial_pose(self, proc, pose):
        """AMCL only publishes map->odom once it has a pose, and Nav2 waits on that."""
        end = time.time() + 120
        while time.time() < end and proc.alive and not self.closed:
            if (proc.ready         # "Managed nodes are active": AMCL is active
                    and self.node.pub_init.get_subscription_count() > 0):
                self.node.set_initial_pose(*pose)
                for _ in range(2):
                    time.sleep(0.5)
                    self.node.set_initial_pose(*pose, log=False)
                return
            time.sleep(0.5)

    def _stop(self, name, grace=15.0):
        for dep in DEPENDENTS.get(name, []):
            self._stop(dep, grace)
        p = self.procs.get(name)
        if p is None or (not p.alive and not p._group_alive()):
            # p set = we launched it and it already ended; its node may linger in the graph
            if p is None and self.up(name) and name not in DEPENDENTS:
                self.node.event('warn', f'{SERVICES[name][0]} was not started here; '
                                        'stop it where it was launched')
            return
        label = SERVICES[name][0]
        self.busy = f'stopping {label}'
        self.node.event('info', f'Stopping {label} ...')
        if name in ('navigation', 'robot'):
            self.node.cancel(f'Navigation canceled: stopping {label}')
        p.stop(grace)
        self.node.event('info', f'{label} stopped')

    def _stop_all(self, grace=15.0):
        for name in ('navigation', 'slam', 'localization', 'robot'):
            self._stop(name, grace)

    def _wait_ready(self, name, timeout=120.0):
        end = time.time() + timeout
        while time.time() < end:
            if self.abort.is_set() or self.closed:
                return False
            p = self.procs.get(name)
            if p is not None and not p.alive:
                self.node.event('error', f'{SERVICES[name][0]} exited (code {p.rc}); see its log')
                return False
            if self.is_ready(name):
                return True
            time.sleep(0.5)
        self.node.event('error', f'{SERVICES[name][0]} did not come up within {timeout:.0f} s')
        return False

    def _start_ready(self, preset, name, cmd, desc, pose):
        """Start one preset step and wait for it. Nav2's lifecycle bringup occasionally
        stalls right after Gazebo starts, so a step that does not come up gets one restart."""
        label = SERVICES[name][0]
        for attempt in (1, 2):
            self.busy = f'{preset}: waiting for {label}'
            if not self._start(name, cmd, desc, pose):
                return False
            if self._wait_ready(name, timeout=120.0 if name == 'robot' or attempt == 2 else 45.0):
                return True
            if attempt == 2 or self.abort.is_set() or self.closed:
                return False
            self.node.event('warn', f'Restarting {label} (attempt 2 of 2)')
            self._stop(name)
            # its node can linger in the graph; _start would take it for an external one
            end = time.time() + 20.0
            while self.up(name) and time.time() < end and not self.abort.is_set():
                time.sleep(0.5)
        return False

    def _preset(self, preset, steps, pose):
        self.node.event('info', f'Preset "{preset}": ' + ' → '.join(SERVICES[n][0] for n, _, _ in steps))
        for name, cmd, desc in steps:
            if self.abort.is_set():
                break
            if not self._start_ready(preset, name, cmd, desc,
                                     pose if name == 'localization' else None):
                break
        else:
            self.node.event('info', f'Preset "{preset}" ready')
            return
        if self.abort.is_set():
            self.node.event('warn', f'Preset "{preset}" interrupted')

    def shutdown(self):
        """Dashboard exiting: stop everything it started (short grace: launch escalates on us)."""
        self.closed = True
        self.abort.set()
        for name in ('navigation', 'slam', 'localization', 'robot'):
            p = self.procs.get(name)
            if p is not None and (p.alive or p._group_alive()):
                p.stop(grace=10.0)
        self.jobs.put((None, ()))

    # ---- state ----
    def status(self):
        nodes = self.node.nodes
        out = {}
        for name, (label, probe) in SERVICES.items():
            p = self.procs.get(name)
            up = probe in nodes
            if p is not None and p.alive:
                state = 'stopping' if p.stopping else 'running' if self.is_ready(name) else 'starting'
            elif up and p is not None and p.ended and time.time() - p.ended < 8:
                state = 'stopping'      # the ROS graph lags a few seconds behind the exit
            elif up:
                state = 'external'
            elif p is not None and not p.stopping and p.rc not in (None, 0):
                state = 'failed'
            else:
                state = 'stopped'
            out[name] = {'label': label, 'state': state, 'desc': p.desc if p else '',
                         'uptime': r(time.time() - p.started, 0) if p and p.alive else None,
                         'rc': p.rc if p else None,
                         'available': not (name == 'robot' and self.kind == 'none')}
        return {'services': out, 'busy': self.busy, 'robot_launch': self.kind,
                'enabled': self.node.get_parameter('stack_control').value}

    def log(self, name, n=300):
        p = self.procs.get(name)
        return list(p.log)[-n:] if p else []


def yaw_of(q):
    return math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))


def r(v, n=3):
    return round(float(v), n)


class Dashboard(Node):
    def __init__(self):
        super().__init__('nova_dashboard')
        self.declare_parameter('host', '127.0.0.1')
        self.declare_parameter('port', 8080)
        self.declare_parameter('token', '')
        self.declare_parameter('robot_name', 'Nova AMR')
        share = self.share = get_package_share_directory('nova_bot')
        self.declare_parameter('stations_file',
                               os.path.join(share, 'config', 'warehouse_stations.yaml'))
        self.declare_parameter('web_dir', os.path.join(share, 'web'))
        self.declare_parameter('map_dir', os.path.expanduser('~/nova_ws/maps'))
        # robot stack control from the page
        self.declare_parameter('stack_control', True)
        self.declare_parameter('robot_launch', 'sim')        # sim | real | none
        self.declare_parameter('default_world', 'obstacles.world')
        # robot_launch:=real only: extra launch_robot.launch.py arguments (nova_run --real)
        self.declare_parameter('robot_args', '')
        # Start a preset as soon as the dashboard is up (used by `nova_run`). The page owns
        # those launches, so it can stop / restart / switch them like any started from it.
        self.declare_parameter('autostart', '')              # '' | mapping | navigation
        self.declare_parameter('autostart_map', '')          # saved map name for navigation
        self.declare_parameter('autostart_headless', False)  # Gazebo without its GUI
        # Allowed browser origin for the API when the UI is served elsewhere, e.g. the
        # Next.js dev server (http://localhost:3000). Empty = same origin only.
        self.declare_parameter('cors_origin', '')

        self.lock = threading.Lock()
        self.events = collections.deque(maxlen=200)
        self.event_seq = 0
        self.map_msg, self.map_version, self.map_blob = None, 0, None
        self.scan_pts, self.plan_pts, self.odom, self.amcl = [], [], None, None
        self.battery, self.cmd_out, self.cmd_out_t = None, (0.0, 0.0), 0.0
        self.jpeg, self.jpeg_seq = None, 0
        self.jpeg_cond = threading.Condition()
        self.estop = False
        self.nodes, self.lifecycle = set(), {}
        self.nav = {'state': 'idle', 'target': None, 'feedback': None, 'started': None,
                    'initial_distance': None}
        self.goal_handle = None
        self.goal_token = 0
        self.ext_goal = None        # uuid of a Nav2 goal sent by another client (RViz, scripts)
        self.mission = {'queue': [], 'loop': False, 'all': [], 'index': 0}
        self.maps_version, self.stations_version = 0, 0

        # Stations edited on the page are saved next to the maps, so the package's
        # config/warehouse_stations.yaml stays the untouched default.
        self.user_stations = os.path.join(self.get_parameter('map_dir').value, 'stations.yaml')
        src = (self.user_stations if os.path.isfile(self.user_stations)
               else self.get_parameter('stations_file').value)
        with open(src) as f:
            self.stations = {s['id']: s for s in (yaml.safe_load(f) or {}).get('stations') or []}

        self.tf = Buffer()
        TransformListener(self.tf, self)

        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL,
                             reliability=ReliabilityPolicy.RELIABLE)
        self.create_subscription(OccupancyGrid, '/map', self.on_map, latched)
        self.create_subscription(LaserScan, '/scan', self.on_scan, qos_profile_sensor_data)
        self.create_subscription(Odometry, '/odom', self.on_odom, 10)
        self.create_subscription(Path, '/plan', self.on_plan, 10)
        self.create_subscription(PoseWithCovarianceStamped, '/amcl_pose', self.on_amcl, latched)
        self.create_subscription(BatteryState, '/battery_state', self.on_battery, 10)
        self.create_subscription(TwistStamped, '/diff_cont/cmd_vel', self.on_cmd_out, 10)
        self.create_subscription(CompressedImage, '/camera/image_raw/compressed',
                                 self.on_image, qos_profile_sensor_data)
        # Follow goals from any client (RViz "Nav2 Goal", scripts), not only our own
        self.create_subscription(GoalStatusArray, '/navigate_to_pose/_action/status',
                                 self.on_action_status, 10)
        self.create_subscription(NavigateToPose.Impl.FeedbackMessage,
                                 '/navigate_to_pose/_action/feedback', self.on_action_feedback, 10)

        self.pub_cmd = self.create_publisher(TwistStamped, '/cmd_vel_dashboard', 10)
        self.pub_estop = self.create_publisher(Bool, '/e_stop', 10)
        self.pub_init = self.create_publisher(PoseWithCovarianceStamped, '/initialpose', 10)
        self.nav_client = ActionClient(self, NavigateToPose, 'navigate_to_pose')
        # zero goal id + zero stamp = cancel every goal, whichever client sent it
        self.cancel_all_client = self.create_client(CancelGoal,
                                                    '/navigate_to_pose/_action/cancel_goal')
        self.state_clients = {n: self.create_client(GetState, f'/{n}/get_state')
                              for n in ('bt_navigator', 'amcl', 'slam_toolbox', 'map_server')}

        # Wall-clock timers: with use_sim_time they would stop whenever Gazebo (/clock) is
        # not running, i.e. exactly when the robot stack is stopped from the page.
        steady = Clock(clock_type=ClockType.STEADY_TIME)
        self.create_timer(0.2, self.publish_estop, clock=steady)
        self.create_timer(2.0, self.poll_graph, clock=steady)
        self.stack = Stack(self)
        self.event('info', 'Dashboard node started')
        self.autostart()

    def autostart(self):
        preset = self.get_parameter('autostart').value.strip()
        if not preset:
            return
        o = {'world': self.get_parameter('default_world').value,
             'headless': self.get_parameter('autostart_headless').value}
        if preset == 'navigation':
            # the sim spawns the robot at the origin, so AMCL can start from there
            o.update(map=self.get_parameter('autostart_map').value, x=0.0, y=0.0, yaw=0.0)
        try:
            _, msg = self.stack.request_preset(preset, o)
            self.event('info', f'Autostart: {msg}')
        except ValueError as e:
            self.event('error', f'Autostart "{preset}" failed: {e}')

    # ---------------- events ----------------
    def event(self, level, text):
        with self.lock:
            self.event_seq += 1
            self.events.append({'seq': self.event_seq, 't': time.strftime('%H:%M:%S'),
                                'level': level, 'text': text})
        # one call site per severity: rclpy rejects mixed severities from a single call site
        if level == 'error':
            self.get_logger().error(text)
        elif level == 'warn':
            self.get_logger().warn(text)
        else:
            self.get_logger().info(text)

    # ---------------- subscriptions ----------------
    def on_map(self, m):
        blob = base64.b64encode(bytes((v & 0xFF) for v in m.data)).decode()
        with self.lock:
            self.map_msg, self.map_blob = m, blob
            self.map_version += 1

    def on_scan(self, m):
        try:
            t = self.tf.lookup_transform('map', m.header.frame_id, Time())
        except Exception:
            return
        tx, ty = t.transform.translation.x, t.transform.translation.y
        th = yaw_of(t.transform.rotation)
        c, s = math.cos(th), math.sin(th)
        pts = []
        for i in range(0, len(m.ranges), 2):
            d = m.ranges[i]
            if not (m.range_min <= d <= m.range_max) or math.isinf(d):
                continue
            a = m.angle_min + i * m.angle_increment
            lx, ly = d * math.cos(a), d * math.sin(a)
            pts += [r(tx + c * lx - s * ly, 2), r(ty + s * lx + c * ly, 2)]
        with self.lock:
            self.scan_pts = pts

    def on_odom(self, m):
        with self.lock:
            self.odom = m

    def on_plan(self, m):
        step = max(1, len(m.poses) // 200)
        pts = []
        for p in m.poses[::step] + m.poses[-1:]:
            pts += [r(p.pose.position.x, 2), r(p.pose.position.y, 2)]
        with self.lock:
            self.plan_pts = pts

    def on_amcl(self, m):
        with self.lock:
            self.amcl = m

    def on_battery(self, m):
        with self.lock:
            self.battery = {'percent': r(m.percentage * 100, 1) if m.percentage == m.percentage
                            else None, 'voltage': r(m.voltage, 2)}

    def on_cmd_out(self, m):
        with self.lock:
            self.cmd_out = (m.twist.linear.x, m.twist.angular.z)
            self.cmd_out_t = time.time()

    def own_goal(self, uuid):
        h = self.goal_handle
        return h is not None and bytes(h.goal_id.uuid) == bytes(uuid)

    def on_action_status(self, m):
        if not m.status_list:
            return
        st = m.status_list[-1]
        uuid = bytes(st.goal_info.goal_id.uuid)
        if self.own_goal(uuid) or self.nav['state'] == 'sending':
            return
        active = st.status in (GoalStatus.STATUS_ACCEPTED, GoalStatus.STATUS_EXECUTING,
                               GoalStatus.STATUS_CANCELING)
        if active and self.ext_goal != uuid:
            self.ext_goal = uuid
            if self.goal_handle is None:
                self.mission_reset()
            with self.lock:
                self.nav.update(state='navigating', feedback=None, started=time.time(),
                                initial_distance=None,
                                target={'x': None, 'y': None, 'yaw': 0.0, 'label': 'external goal'})
            self.event('info', 'Nav2 goal from another client (RViz / script)')
        elif not active and self.ext_goal == uuid:
            self.ext_goal = None
            state = STATUS.get(st.status, f'status {st.status}')
            with self.lock:
                self.nav['state'] = state
                self.plan_pts = []
            self.event('info' if state == 'succeeded' else 'warn', f'External goal {state}')

    def on_action_feedback(self, m):
        if self.ext_goal is None or bytes(m.goal_id.uuid) != self.ext_goal:
            return
        self.on_feedback(m)
        with self.lock:      # the goal itself isn't published; use the end of the plan
            if self.plan_pts and self.nav['target'] and self.nav['target']['x'] is None:
                self.nav['target'].update(x=self.plan_pts[-2], y=self.plan_pts[-1])

    def on_image(self, m):
        with self.jpeg_cond:
            self.jpeg = bytes(m.data)
            self.jpeg_seq += 1
            self.jpeg_cond.notify_all()

    # ---------------- periodic ----------------
    def publish_estop(self):
        self.pub_estop.publish(Bool(data=self.estop))

    def poll_graph(self):
        names = set(self.get_node_names())
        with self.lock:
            self.nodes = names
        for n, cli in self.state_clients.items():
            if n not in names or not cli.service_is_ready():
                self.lifecycle[n] = None
                continue
            fut = cli.call_async(GetState.Request())
            fut.add_done_callback(
                lambda f, n=n: self.lifecycle.__setitem__(
                    n, f.result().current_state.label if f.result() else None))

    # ---------------- navigation ----------------
    def make_pose(self, x, y, yaw):
        p = PoseStamped()
        p.header.frame_id = 'map'
        p.header.stamp = self.get_clock().now().to_msg()
        p.pose.position.x, p.pose.position.y = float(x), float(y)
        p.pose.orientation.z, p.pose.orientation.w = math.sin(yaw / 2), math.cos(yaw / 2)
        return p

    def send_goal(self, x, y, yaw, label):
        if self.estop:
            return False, 'E-stop is active'
        if not self.nav_client.server_is_ready():
            return False, 'Nav2 is not running (navigate_to_pose action unavailable)'
        self.goal_token += 1
        token = self.goal_token
        goal = NavigateToPose.Goal(pose=self.make_pose(x, y, yaw))
        with self.lock:
            self.nav.update(state='sending', target={'x': r(x), 'y': r(y), 'yaw': r(yaw),
                                                     'label': label},
                            feedback=None, started=time.time(), initial_distance=None)
        fut = self.nav_client.send_goal_async(goal, feedback_callback=self.on_feedback)
        fut.add_done_callback(lambda f: self.on_goal_response(f, token, label))
        self.event('info', f'Goal sent: {label} ({x:.2f}, {y:.2f})')
        return True, 'goal sent'

    def on_feedback(self, msg):
        fb = msg.feedback
        with self.lock:
            if self.nav['initial_distance'] is None and fb.distance_remaining > 0:
                self.nav['initial_distance'] = fb.distance_remaining
            self.nav['feedback'] = {
                'distance_remaining': r(fb.distance_remaining, 2),
                'eta': r(fb.estimated_time_remaining.sec
                         + fb.estimated_time_remaining.nanosec * 1e-9, 1),
                'navigation_time': r(fb.navigation_time.sec
                                     + fb.navigation_time.nanosec * 1e-9, 1),
                'recoveries': int(fb.number_of_recoveries)}

    def on_goal_response(self, fut, token, label):
        handle = fut.result()
        if token != self.goal_token:
            return
        if not handle.accepted:
            with self.lock:
                self.nav['state'] = 'rejected'
            self.event('error', f'Goal rejected by Nav2: {label}')
            self.mission_reset()
            return
        self.goal_handle = handle
        with self.lock:
            self.nav['state'] = 'navigating'
        handle.get_result_async().add_done_callback(
            lambda f: self.on_result(f, token, label))

    def on_result(self, fut, token, label):
        res = fut.result()
        state = STATUS.get(res.status, f'status {res.status}')
        if token != self.goal_token:
            return
        self.goal_handle = None
        with self.lock:
            self.nav['state'] = state
            self.plan_pts = []
        elapsed = time.time() - (self.nav['started'] or time.time())
        err = getattr(res.result, 'error_msg', '')
        self.event('info' if state == 'succeeded' else 'warn',
                   f'Goal {state}: {label} after {elapsed:.0f} s' + (f' ({err})' if err else ''))
        if state == 'succeeded':
            self.mission_next()
        else:
            self.mission_reset()

    def cancel(self, reason='Navigation canceled'):
        self.mission_reset()
        active = self.goal_handle is not None or self.ext_goal is not None
        if self.goal_handle is not None:
            self.goal_handle.cancel_goal_async()
        if self.cancel_all_client.service_is_ready():
            self.cancel_all_client.call_async(CancelGoal.Request())
        if active:
            self.event('warn', reason)
        with self.lock:
            if self.nav['state'] in ('sending', 'navigating'):
                self.nav['state'] = 'canceling'

    # ---------------- missions ----------------
    def start_mission(self, ids, loop):
        bad = [i for i in ids if i not in self.stations]
        if bad or not ids:
            return False, f'unknown stations: {bad}' if bad else 'empty mission'
        with self.lock:
            self.mission = {'queue': list(ids), 'loop': bool(loop), 'all': list(ids), 'index': 0}
        self.event('info', 'Mission started: ' + ' -> '.join(
            self.stations[i]['name'] for i in ids) + (' (loop)' if loop else ''))
        return self.mission_next(first=True)

    def mission_next(self, first=False):
        with self.lock:
            m = self.mission
            if not first and m['queue']:
                m['queue'].pop(0)
                m['index'] += 1
            if not m['queue'] and m['loop'] and m['all']:
                m['queue'] = list(m['all'])
            nxt = m['queue'][0] if m['queue'] else None
        if nxt is None:
            if not first and self.mission['all']:
                self.event('info', 'Mission complete')
                self.mission_reset()
            return True, 'done'
        s = self.stations[nxt]
        return self.send_goal(s['x'], s['y'], s['yaw'], s['name'])

    def mission_reset(self):
        with self.lock:
            self.mission = {'queue': [], 'loop': False, 'all': [], 'index': 0}

    # ---------------- manual control ----------------
    def teleop(self, vx, wz):
        if self.estop:
            return False, 'E-stop is active'
        t = TwistStamped()
        t.header.stamp = self.get_clock().now().to_msg()
        t.header.frame_id = 'base_link'
        t.twist.linear.x = max(-MAX_VX, min(MAX_VX, float(vx)))
        t.twist.angular.z = max(-MAX_WZ, min(MAX_WZ, float(wz)))
        self.pub_cmd.publish(t)
        return True, 'ok'

    def set_estop(self, on):
        if on and not self.estop:
            self.estop = True
            self.publish_estop()
            self.cancel('Navigation canceled by E-STOP')
            self.event('error', 'E-STOP ENGAGED: all motion blocked')
        elif not on and self.estop:
            self.estop = False
            self.publish_estop()
            self.event('warn', 'E-stop released')
        return True, 'ok'

    def set_initial_pose(self, x, y, yaw, log=True):
        m = PoseWithCovarianceStamped()
        m.header.frame_id = 'map'
        m.header.stamp = self.get_clock().now().to_msg()
        m.pose.pose = self.make_pose(x, y, yaw).pose
        m.pose.covariance[0] = m.pose.covariance[7] = 0.25
        m.pose.covariance[35] = 0.07
        self.pub_init.publish(m)
        if log:
            self.event('info', f'Initial pose set to ({x:.2f}, {y:.2f}, {math.degrees(yaw):.0f} deg)')
        return True, 'ok'

    def save_map(self, name):
        name = ''.join(c for c in name if c.isalnum() or c in '-_') or 'warehouse_map'
        if name == 'stations':
            return False, '"stations" is reserved for the stations file'
        if self.map_msg is None:
            return False, 'No map to save: start mapping (SLAM) first'
        path = os.path.join(self.get_parameter('map_dir').value, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        sim = 'true' if self.get_parameter('use_sim_time').value else 'false'

        def work():
            try:
                p = subprocess.run(['ros2', 'run', 'nav2_map_server', 'map_saver_cli', '-f', path,
                                    '--ros-args', '-p', 'use_sim_time:=' + sim],
                                   capture_output=True, text=True, timeout=60)
                ok = 'saved successfully' in (p.stdout + p.stderr)
            except subprocess.TimeoutExpired:
                ok = False
            if ok:
                with self.lock:
                    self.maps_version += 1
            self.event('info' if ok else 'error',
                       f'Map saved to {path}.yaml' if ok else f'Map save failed ({path})')
        threading.Thread(target=work, daemon=True).start()
        self.event('info', f'Saving map as {name} ...')
        return True, path + '.yaml'

    # ---------------- stations ----------------
    def write_stations(self):
        os.makedirs(os.path.dirname(self.user_stations), exist_ok=True)
        tmp = self.user_stations + '.tmp'
        with open(tmp, 'w') as f:
            f.write('# Warehouse stations, edited from the Nova dashboard (map frame, m / rad).\n')
            yaml.safe_dump({'stations': list(self.stations.values())}, f, sort_keys=False)
        os.replace(tmp, self.user_stations)
        with self.lock:
            self.stations_version += 1

    def add_station(self, name, x=None, y=None, yaw=None):
        name = ' '.join(str(name).split())[:40]
        if not name:
            return False, 'station name is empty'
        if x is None or y is None:
            p = self.robot_pose()
            if p is None or p['frame'] != 'map':
                return False, 'Robot pose in the map frame is unknown (start SLAM or localization)'
            x, y, yaw = p['x'], p['y'], p['yaw']
        base = re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_') or 'station'
        sid, i = base, 2
        while sid in self.stations:
            sid, i = f'{base}_{i}', i + 1
        self.stations[sid] = {'id': sid, 'name': name, 'x': r(x, 2), 'y': r(y, 2),
                              'yaw': r(yaw or 0.0, 2)}
        self.write_stations()
        self.event('info', f'Station added: {name} ({x:.2f}, {y:.2f})')
        return True, sid

    def delete_station(self, sid):
        if sid not in self.stations:
            return False, 'unknown station'
        if sid in self.mission['queue']:
            return False, 'station is part of the running mission'
        s = self.stations.pop(sid)
        self.write_stations()
        self.event('info', f'Station deleted: {s["name"]}')
        return True, 'deleted'

    # ---------------- state snapshot ----------------
    def robot_pose(self):
        for frame in ('map', 'odom'):
            try:
                t = self.tf.lookup_transform(frame, 'base_link', Time())
                tr = t.transform
                return {'x': r(tr.translation.x), 'y': r(tr.translation.y),
                        'yaw': r(yaw_of(tr.rotation)), 'frame': frame}
            except Exception:
                continue
        return None

    def snapshot(self, since_event=0):
        pose = self.robot_pose()
        with self.lock:
            nodes = self.nodes
            odom = self.odom
            nav = dict(self.nav)
            if nav['feedback'] and nav['initial_distance']:
                nav['progress'] = r(max(0.0, min(1.0, 1 - nav['feedback']['distance_remaining']
                                                 / nav['initial_distance'])), 3)
            mode = ('slam' if 'slam_toolbox' in nodes else
                    'localization' if 'amcl' in nodes else 'odometry')
            amcl = None
            if self.amcl is not None:
                c = self.amcl.pose.covariance
                amcl = {'std_xy': r(math.sqrt(max(c[0], c[7], 0)), 3),
                        'std_yaw_deg': r(math.degrees(math.sqrt(max(c[35], 0))), 1)}
            cmd_fresh = time.time() - self.cmd_out_t < 0.6
            state = {
                'robot': self.get_parameter('robot_name').value,
                'ros_time': r(self.get_clock().now().nanoseconds * 1e-9, 1),
                'mode': mode,
                'estop': self.estop,
                'pose': pose,
                'velocity': ({'vx': r(odom.twist.twist.linear.x), 'wz': r(odom.twist.twist.angular.z)}
                             if odom else None),
                'command': {'vx': r(self.cmd_out[0]), 'wz': r(self.cmd_out[1])}
                if cmd_fresh else {'vx': 0.0, 'wz': 0.0},
                'amcl': amcl,
                'battery': self.battery,
                'nav': nav,
                'nav2_ready': self.nav_client.server_is_ready(),
                'mission': {'queue': [self.stations[i]['name'] for i in self.mission['queue']],
                            'loop': self.mission['loop'],
                            'active': bool(self.mission['all'])},
                'lifecycle': dict(self.lifecycle),
                'health': [{'node': n, 'role': role, 'up': n in nodes} for n, role in HEALTH],
                'map_version': self.map_version,
                'maps_version': self.maps_version,
                'stations_version': self.stations_version,
                'scan': self.scan_pts,
                'plan': self.plan_pts,
                'camera': self.jpeg_seq > 0,
                'events': [e for e in self.events if e['seq'] > since_event],
            }
        state['stack'] = self.stack.status()
        return state


def make_handler(node):
    web_dir = node.get_parameter('web_dir').value
    token = node.get_parameter('token').value
    cors = node.get_parameter('cors_origin').value
    types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
             '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
             '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain',
             '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json'}

    def resolve(path):
        """URL path -> file in web_dir (the Next.js static export: /map -> map.html or
        map/index.html). None if outside web_dir or missing."""
        # normpath (not realpath): with --symlink-install the files are symlinks into src/
        root = os.path.normpath(web_dir)
        rel = path.lstrip('/')
        for cand in (rel, os.path.join(rel, 'index.html'), rel.rstrip('/') + '.html'):
            full = os.path.normpath(os.path.join(root, cand))
            if (full == root or full.startswith(root + os.sep)) and os.path.isfile(full):
                return full
        return None

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *a):
            pass

        def authorized(self):
            if not token:
                return True
            q = parse_qs(urlparse(self.path).query)
            return q.get('token', [''])[0] == token or self.headers.get('X-Token') == token

        def end_headers(self):
            if cors and self.headers.get('Origin') == cors:
                self.send_header('Access-Control-Allow-Origin', cors)
                self.send_header('Vary', 'Origin')
            super().end_headers()

        def do_HEAD(self):          # Next.js route prefetching probes pages with HEAD
            path = urlparse(self.path).path
            full = None if path.startswith('/api/') else resolve(path)
            self.send_response(200 if full else 404)
            self.send_header('Content-Type', types.get(os.path.splitext(full)[1], 'text/plain')
                             if full else 'application/json')
            self.send_header('Content-Length', str(os.path.getsize(full)) if full else '0')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()

        def do_OPTIONS(self):       # CORS preflight for JSON POSTs
            self.send_response(204)
            if cors:
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Token')
                self.send_header('Access-Control-Max-Age', '600')
            self.send_header('Content-Length', '0')
            self.end_headers()

        def send(self, code, body, ctype='application/json'):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
            elif isinstance(body, str):
                body = body.encode()
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urlparse(self.path).path
            if not path.startswith('/api/'):
                full = resolve(path)
                if full is None:
                    nf = resolve('/404.html')
                    if nf is None:
                        return self.send(404, {'error': 'not found'})
                    with open(nf, 'rb') as fh:
                        return self.send(404, fh.read(), types['.html'])
                with open(full, 'rb') as fh:
                    body = fh.read()
                self.send_response(200)
                self.send_header('Content-Type', types.get(os.path.splitext(full)[1], 'text/plain'))
                self.send_header('Content-Length', str(len(body)))
                # hashed Next.js build assets never change; pages must always be fresh
                self.send_header('Cache-Control', 'public, max-age=31536000, immutable'
                                 if path.startswith('/_next/static/') else 'no-store')
                self.end_headers()
                return self.wfile.write(body)
            if not self.authorized():
                return self.send(401, {'error': 'bad or missing token'})
            if path == '/api/stream':
                return self.stream()
            if path == '/api/camera.mjpg':
                return self.mjpeg()
            if path == '/api/map':
                with node.lock:
                    m, blob, ver = node.map_msg, node.map_blob, node.map_version
                if m is None:
                    return self.send(404, {'error': 'no map yet'})
                o = m.info.origin
                return self.send(200, {'version': ver, 'width': m.info.width,
                                       'height': m.info.height, 'resolution': m.info.resolution,
                                       'origin': [o.position.x, o.position.y, yaw_of(o.orientation)],
                                       'data': blob})
            if path == '/api/stations':
                return self.send(200, list(node.stations.values()))
            if path == '/api/stack/options':
                return self.send(200, node.stack.options())
            if path == '/api/stack/log':
                svc = parse_qs(urlparse(self.path).query).get('service', [''])[0]
                if svc not in SERVICES:
                    return self.send(404, {'error': 'unknown service'})
                return self.send(200, {'service': svc, 'lines': node.stack.log(svc)})
            if path == '/api/state':
                return self.send(200, node.snapshot())
            self.send(404, {'error': 'not found'})

        def stream(self):
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'keep-alive')
            self.end_headers()
            last = 0
            try:
                while rclpy.ok():
                    s = node.snapshot(since_event=last)
                    if s['events']:
                        last = s['events'][-1]['seq']
                    self.wfile.write(b'data: ' + json.dumps(s).encode() + b'\n\n')
                    self.wfile.flush()
                    time.sleep(0.2)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def mjpeg(self):
            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            seq = -1
            try:
                while rclpy.ok():
                    with node.jpeg_cond:
                        node.jpeg_cond.wait_for(lambda: node.jpeg_seq != seq, timeout=5)
                        if node.jpeg is None:
                            continue
                        seq, frame = node.jpeg_seq, node.jpeg
                    self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: '
                                     + str(len(frame)).encode() + b'\r\n\r\n' + frame + b'\r\n')
                    self.wfile.flush()
                    time.sleep(0.066)   # cap at ~15 fps
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_POST(self):
            if not self.authorized():
                return self.send(401, {'error': 'bad or missing token'})
            n = int(self.headers.get('Content-Length') or 0)
            try:
                body = json.loads(self.rfile.read(n) or b'{}')
            except ValueError:
                return self.send(400, {'error': 'invalid JSON'})
            path = urlparse(self.path).path
            try:
                if path == '/api/goal':
                    if 'station' in body:
                        s = node.stations.get(body['station'])
                        if not s:
                            return self.send(404, {'error': 'unknown station'})
                        node.mission_reset()
                        ok, msg = node.send_goal(s['x'], s['y'], s['yaw'], s['name'])
                    else:
                        node.mission_reset()
                        ok, msg = node.send_goal(float(body['x']), float(body['y']),
                                                 float(body.get('yaw', 0.0)), 'map goal')
                elif path == '/api/mission':
                    ok, msg = node.start_mission(body.get('stations', []), body.get('loop', False))
                elif path == '/api/cancel':
                    node.cancel()
                    ok, msg = True, 'canceled'
                elif path == '/api/cmd_vel':
                    ok, msg = node.teleop(body.get('vx', 0.0), body.get('wz', 0.0))
                elif path == '/api/estop':
                    ok, msg = node.set_estop(bool(body.get('on', True)))
                elif path == '/api/initialpose':
                    ok, msg = node.set_initial_pose(float(body['x']), float(body['y']),
                                                    float(body.get('yaw', 0.0)))
                elif path == '/api/save_map':
                    ok, msg = node.save_map(str(body.get('name', 'warehouse_map')))
                elif path == '/api/stations':
                    if body.get('action') == 'add':
                        has_xy = body.get('x') is not None and body.get('y') is not None
                        ok, msg = node.add_station(
                            body.get('name', ''),
                            *((float(body['x']), float(body['y']), float(body.get('yaw') or 0.0))
                              if has_xy else ()))
                    elif body.get('action') == 'delete':
                        ok, msg = node.delete_station(str(body.get('id', '')))
                    else:
                        return self.send(400, {'error': 'action must be add or delete'})
                elif path == '/api/stack/start':
                    ok, msg = node.stack.request_start(str(body.get('service', '')), body)
                elif path == '/api/stack/stop':
                    ok, msg = node.stack.request_stop(str(body.get('service', '')))
                elif path == '/api/stack/preset':
                    ok, msg = node.stack.request_preset(str(body.get('preset', '')), body)
                else:
                    return self.send(404, {'error': 'not found'})
            except (KeyError, TypeError, ValueError) as e:
                return self.send(400, {'error': f'bad request: {e}', 'message': str(e)})
            self.send(200 if ok else 409, {'ok': ok, 'message': msg})

    return Handler


def main():
    rclpy.init()
    node = Dashboard()
    executor = MultiThreadedExecutor(num_threads=4)
    executor.add_node(node)

    host, port = node.get_parameter('host').value, node.get_parameter('port').value
    server = ThreadingHTTPServer((host, port), make_handler(node))
    server.daemon_threads = True
    # HTTP in a worker thread; ROS spins in the main thread so rclpy's own SIGINT
    # handling (Ctrl-C, ros2 launch shutdown) ends spin() and then the server.
    http_thread = threading.Thread(target=server.serve_forever, daemon=True)
    http_thread.start()
    shown = 'localhost' if host in ('0.0.0.0', '127.0.0.1') else host
    node.get_logger().info(f'Nova dashboard on http://{shown}:{port}'
                           + ('  (token required)' if node.get_parameter('token').value else ''))
    try:
        executor.spin()
    except (KeyboardInterrupt, rclpy.executors.ExternalShutdownException):
        pass
    finally:
        node.stack.shutdown()       # stop every launch started from the page
        server.shutdown()
        server.server_close()
        executor.shutdown()
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
