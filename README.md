# nova_bot

ROS 2 package for **Nova**, a differential-drive autonomous mobile robot (AMR).
It is based on the `new_gazebo` branch of
[joshnewans/articubot_one](https://github.com/joshnewans/articubot_one) and targets
**ROS 2 Jazzy on Ubuntu 24.04 with Gazebo Harmonic**.

Current stage: **simulation** (drive, map, navigate). Real-hardware bringup is still
the upstream placeholder — see [Real robot](#real-robot-not-done-yet).

## Layout

| Folder | Contents |
| --- | --- |
| `description/` | URDF/xacro: chassis, wheels, lidar, camera, ros2_control |
| `launch/` | `launch_sim`, `slam`, `navigation`, `localization`, `launch_robot`, … |
| `config/` | controllers, twist_mux, joystick, Gazebo bridge, slam_toolbox, RViz |
| `worlds/` | `empty.world`, `obstacles.world` |
| `scripts/` | `setup_ubuntu.sh` — one-time install + build |

## Setup (Ubuntu 24.04)

Copy the whole workspace folder (the one containing `src/nova_bot`) to the Ubuntu
machine, e.g. as `~/hiro_ws`, then:

```bash
cd ~/hiro_ws
bash src/nova_bot/scripts/setup_ubuntu.sh
```

The script installs ROS 2 Jazzy if it is missing, installs every dependency listed in
`package.xml` through `rosdep`, and runs `colcon build --symlink-install`.

In every new terminal:

```bash
source /opt/ros/jazzy/setup.bash
source ~/hiro_ws/install/setup.bash
```

## Quick start: the whole bot in one command

```bash
ros2 launch nova_bot bringup_sim.launch.py                      # Gazebo + SLAM + Nav2 + RViz
ros2 launch nova_bot bringup_sim.launch.py mode:=localization \
    map:=$HOME/hiro_ws/maps/my_map_v2.yaml                      # AMCL on a saved map
```

Arguments: `world`, `mode` (`slam` | `localization`), `map`, `nav`, `rviz`, and `x`/`y`/`yaw`
(the initial AMCL pose, which is sent automatically in localization mode).

Check each task against the running sim:

```bash
python3 src/nova_bot/scripts/nova_tasks.py drive                  # teleop chain + odometry
python3 src/nova_bot/scripts/nova_tasks.py map                    # SLAM is publishing /map
python3 src/nova_bot/scripts/nova_tasks.py nav 2 1.5              # one Nav2 goal
python3 src/nova_bot/scripts/nova_tasks.py patrol 2,1.5 1.8,-2 0,0
```

Each task prints PASS/FAIL and exits non-zero on failure. `obstacles.world` has no walls, so
the map only covers the area around the box and cylinder. In SLAM mode Nav2 rejects goals
outside the mapped area ("Goal Coordinates ... was outside bounds").

## Web dashboard

A Next.js + Tailwind CSS app (`webapp/`), exported as static files into `web/` and served by
the `nova_dashboard.py` ROS node, so the robot needs no Node.js at runtime.

```bash
ros2 launch nova_bot web_control.launch.py          # dashboard only, then open http://localhost:8080
```

Start the robot, mapping, localization and Nav2 from the page. `bringup_sim.launch.py` also starts
the dashboard, and the stack it launched shows as "running (external)".

| Section | What it does |
| --- | --- |
| Overview | Live map preview, robot numbers, stack status, navigation, recent events, quick start |
| Map & Navigate | Click to send a Nav2 goal (drag sets heading), **Set pose** for AMCL, layers, zoom/fit/follow, **Save map** |
| Drive | Hold-to-drive pad or WASD/arrow keys, speed sliders, camera, local map |
| Robot Stack | **Map a new area** (robot + SLAM + Nav2) or **Work on a saved map** (robot + AMCL + Nav2); start/stop each service, live launch output, Stop all |
| Missions | Stations (**Add station here**, Go, delete), build a mission queue, loop, progress |
| System | Node health with lifecycle states, full event log |
| **E-STOP** (always visible, or Space) | `twist_mux` lock at priority 255: blocks every velocity source and cancels navigation |

The robot stack only runs the package's own launch files (`launch_sim`/`launch_robot`, `slam`,
`localization`, `navigation`), never arbitrary commands. Launches started from the page stop when
the dashboard exits. Maps are saved to `~/hiro_ws/maps`; stations edited on the page go to
`~/hiro_ws/maps/stations.yaml` (the package's `config/warehouse_stations.yaml` stays as the default).

Launch arguments: `robot:=sim|real|none`, `use_sim_time`, `host` (`0.0.0.0` exposes it on the LAN),
`port`, `token`, `world`, `map_dir`. On the LAN, always set a token and open
`http://<robot-ip>:8080/?token=<secret>`; there are no user accounts. Battery shows "n/a" until
something publishes `/battery_state`. `robot:=real` uses `launch_robot.launch.py`, which is still a
placeholder (see [Real robot](#real-robot-not-done-yet)).

### Changing the UI

```bash
cd ~/hiro_ws/src/nova_bot/webapp
npm install                     # once
npm run build                   # next build + copy the export into ../web
cd ~/hiro_ws && colcon build --symlink-install --packages-select nova_bot   # install new files
```

Live development with hot reload, against a running dashboard:

```bash
# terminal 1: dashboard API that accepts the dev server's origin
ros2 run nova_bot nova_dashboard.py --ros-args -p use_sim_time:=true -p cors_origin:=http://localhost:3000
# terminal 2
NEXT_PUBLIC_ROBOT_API=http://localhost:8080 npm run dev      # http://localhost:3000
```

The previous single-file UI is kept in `web_classic/index.html` (not installed).

## 1. Drive in simulation

```bash
ros2 launch nova_bot launch_sim.launch.py world:=$HOME/hiro_ws/src/nova_bot/worlds/obstacles.world
```

Second terminal — keyboard teleop:

```bash
ros2 run teleop_twist_keyboard teleop_twist_keyboard
```

A gamepad also works (hold button 6 to enable, see `config/joystick.yaml`).

Velocity command chain:

```
/cmd_vel (Nav2, keyboard) ─ twist_stamper ─ /cmd_vel_stamped ─────┐
/cmd_vel_joy (gamepad) ──── twist_stamper ─ /cmd_vel_joy_stamped ─┤
/cmd_vel_dashboard (web teleop, TwistStamped) ─────────────────────┴─ twist_mux ─ /diff_cont/cmd_vel
/e_stop (std_msgs/Bool lock, priority 255) ─────────────────────────┘
```

Priorities: E-stop lock 255 > gamepad 100 > dashboard 50 > tracker 20 > Nav2/keyboard 10.

`twist_mux` 4.5+ (Jazzy) only accepts and publishes `TwistStamped`, so each plain-`Twist`
source is stamped before the mux. `/cmd_vel_tracker` goes straight into the mux and must be
`TwistStamped`.

Wheel odometry is published on `/diff_cont/odom` and relayed to `/odom`.

## 2. Build a map

With the simulation running:

```bash
ros2 launch nova_bot slam.launch.py
rviz2 -d $HOME/hiro_ws/src/nova_bot/config/map.rviz
```

Drive around until the map is complete, then save it:

```bash
mkdir -p ~/hiro_ws/maps
ros2 run nav2_map_server map_saver_cli -f ~/hiro_ws/maps/my_map
```

## 3. Navigate

While mapping (SLAM provides the `map` frame):

```bash
ros2 launch nova_bot navigation.launch.py
```

Or on a saved map (stop `slam.launch.py` first):

```bash
ros2 launch nova_bot localization.launch.py map:=$HOME/hiro_ws/maps/my_map.yaml
ros2 launch nova_bot navigation.launch.py
```

Open RViz with Nav2's own layout:

```bash
rviz2 -d /opt/ros/jazzy/share/nav2_bringup/rviz/nav2_default_view.rviz
```

Set the initial pose with **2D Pose Estimate** (localization only), then send goals
with **Nav2 Goal**.

Nav2 runs with the stock parameters of the installed distro. To tune for Nova, copy
`/opt/ros/jazzy/share/nav2_bringup/params/nav2_params.yaml` into `config/` and pass
`params_file:=<path>` to both launch files.

## Robot dimensions

The model still has articubot's dimensions. When Nova's chassis is decided, update:

- `description/robot_core.xacro` — chassis size, wheel radius/offsets, masses
- `config/my_controllers.yaml` — `wheel_separation`, `wheel_radius`
- `description/lidar.xacro`, `description/camera.xacro` — sensor positions

## Real robot (not done yet)

`launch/launch_robot.launch.py`, `launch/rplidar.launch.py` and the `RealRobot` block in
`description/ros2_control.xacro` are upstream placeholders: they assume an Arduino motor
controller (`diffdrive_arduino`, built from source) on `/dev/ttyUSB0` and an RPLidar.
They need Nova's actual motor driver, encoder counts, serial ports and lidar model.
