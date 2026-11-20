# nova_bot

ROS 2 package for **Nova**, a differential-drive autonomous mobile robot (AMR).
It is based on the `new_gazebo` branch of
[joshnewans/articubot_one](https://github.com/joshnewans/articubot_one) and targets
**ROS 2 Jazzy on Ubuntu 24.04 with Gazebo Harmonic**.

Runs in **simulation** (drive, map, navigate) and on the **real robot** (Raspberry Pi +
Arduino with a TB6612FNG motor driver + RPLidar), both controlled from the same website;
see [Real robot](#real-robot).

## Layout

| Folder | Contents |
| --- | --- |
| `description/` | URDF/xacro: chassis, wheels, lidar, camera, ros2_control |
| `launch/` | `launch_sim`, `slam`, `navigation`, `localization`, `launch_robot`, … |
| `config/` | controllers, twist_mux, joystick, Gazebo bridge, slam_toolbox, RViz |
| `worlds/` | `empty.world`, `obstacles.world` |
| `scripts/` | `nova_run`, `setup_ubuntu.sh` (one-time install + build), dashboard, `nova_encoders.py` |
| `firmware/` | `NovaArduinoBridge`: Arduino firmware (ros_arduino_bridge + TB6612FNG driver) |
| `external/` | git submodules: `diffdrive_arduino` (ros2_control plugin), `serial_motor_demo`, `ros_arduino_bridge` (upstream firmware) |

## Setup (Ubuntu 24.04)

Copy the whole workspace folder (the one containing `src/nova_bot`) to the Ubuntu
machine, e.g. as `~/nova_ws`, then:

```bash
cd ~/nova_ws
bash src/nova_bot/scripts/setup_ubuntu.sh
```

The script installs ROS 2 Jazzy if it is missing, installs every dependency listed in
`package.xml` through `rosdep`, and runs `colcon build --symlink-install`.

In every new terminal:

```bash
source /opt/ros/jazzy/setup.bash
source ~/nova_ws/install/setup.bash
```

## Quick start: `nova_run`

One command starts the simulation and opens the web dashboard; everything else is done
from the website.

```bash
nova_run                     # map a new area: Gazebo + SLAM + Nav2, dashboard window opens
nova_run nav                 # work on the newest saved map: Gazebo + AMCL + Nav2
nova_run nav my_map          # ... on a specific map in ~/nova_ws/maps
nova_run web                 # dashboard only; start the stack from the page
```

| Option | |
| --- | --- |
| `--world FILE` | Gazebo world in `worlds/` (default `obstacles.world`) |
| `--headless` | Gazebo without its GUI window |
| `--lan` | reachable from phones/laptops on the network; prints `http://<ip>:8080/?token=…` (token from `$NOVA_TOKEN`, or generated) |
| `--port N` | dashboard port (default 8080) |
| `--no-browser` | don't open the dashboard window |

The dashboard starts the stack itself, so the website owns every process: stop, restart, or
switch between mapping and a saved map from **Robot Stack**, and drive, navigate, save maps
and run missions from the other pages. **Ctrl-C** in the `nova_run` terminal, or closing it,
stops everything (Gazebo takes about 15 s). If the dashboard is already running, `nova_run`
just opens it.

`nova_run` lives in `scripts/` and is linked into `~/.local/bin` by `setup_ubuntu.sh`
(`ln -sf ~/nova_ws/src/nova_bot/scripts/nova_run ~/.local/bin/nova_run` by hand).

## The whole bot from a launch file

```bash
ros2 launch nova_bot bringup_sim.launch.py                      # Gazebo + SLAM + Nav2 + RViz
ros2 launch nova_bot bringup_sim.launch.py mode:=localization \
    map:=$HOME/nova_ws/maps/my_map_v2.yaml                      # AMCL on a saved map
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
the dashboard exits. Maps are saved to `~/nova_ws/maps`; stations edited on the page go to
`~/nova_ws/maps/stations.yaml` (the package's `config/warehouse_stations.yaml` stays as the default).

Launch arguments: `robot:=sim|real|none`, `use_sim_time`, `host` (`0.0.0.0` exposes it on the LAN),
`port`, `token`, `world`, `map_dir`, and `autostart:=mapping|navigation` (with `map:=<saved map>`
and `headless:=true`) to start a preset as soon as the dashboard is up, as `nova_run` does. On the LAN, always set a token and open
`http://<robot-ip>:8080/?token=<secret>`; there are no user accounts. Battery shows "n/a" until
something publishes `/battery_state`. `robot:=real` uses `launch_robot.launch.py` (see
[Real robot](#real-robot)); `robot_args:='serial_port:=... lidar_port:=...'` passes its arguments.

### Vercel website on the same Wi-Fi

The Vercel page doesn't connect by itself: it shows a **Connect** form (robot IP + token). With
`--lan` (on by default with `--real`), `nova_run` also serves the API over HTTPS on port 8443. It
uses a self-signed certificate in `~/.config/nova/tls`, which is remade when the robot's IP changes.
Browsers won't let an https page call plain http, which is why the HTTPS port is needed. Any
`https://*.vercel.app` origin is allowed, and the token still guards everything.

1. Put the device on the robot's Wi-Fi. The first time (and after an IP change), open
   `https://<robot-ip>:8443` and accept the certificate warning.
2. Open the Vercel page, enter `<robot-ip>` and the token (`~/.config/nova/token`), press **Connect**.
   **Disconnect** is in the sidebar. `--https-port 0` turns HTTPS off.

### From anywhere: Vercel + Cloudflare tunnel

The UI deployed on Vercel is only static files; the browser talks to the robot directly, so the
robot needs a public HTTPS address. `nova_run --tunnel` opens a Cloudflare quick tunnel (no
account) and prints a ready link:

```bash
bash ~/nova_ws/src/nova_bot/scripts/setup_ubuntu.sh --cloudflared    # once, per machine
echo 'NOVA_WEB_URL=https://<app>.vercel.app' >> ~/.config/nova/robot.env   # once
nova_run --real --tunnel        # or: nova_run --tunnel (simulation)
#   Website:  https://<app>.vercel.app/?api=https://<random>.trycloudflare.com&token=<token>
```

Open the `Website:` link; the page remembers the robot URL and token. The tunnel URL changes on
every run, so use the new link each time (the current one is also in `~/.config/nova/tunnel_url`).
The token is always on with `--tunnel`; anyone with the link can drive the robot, so don't share
it. `NOVA_WEB_URL` (or `--web-url`) is passed to the dashboard as `cors_origin`; that parameter takes
a comma-separated list of origins.

### Changing the UI

```bash
cd ~/nova_ws/src/nova_bot/webapp
npm install                     # once
npm run build                   # next build + copy the export into ../web
cd ~/nova_ws && colcon build --symlink-install --packages-select nova_bot   # install new files
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
ros2 launch nova_bot launch_sim.launch.py world:=$HOME/nova_ws/src/nova_bot/worlds/obstacles.world
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
rviz2 -d $HOME/nova_ws/src/nova_bot/config/map.rviz
```

Drive around until the map is complete, then save it:

```bash
mkdir -p ~/nova_ws/maps
ros2 run nav2_map_server map_saver_cli -f ~/nova_ws/maps/my_map
```

## 3. Navigate

While mapping (SLAM provides the `map` frame):

```bash
ros2 launch nova_bot navigation.launch.py
```

Or on a saved map (stop `slam.launch.py` first):

```bash
ros2 launch nova_bot localization.launch.py map:=$HOME/nova_ws/maps/my_map.yaml
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

## Real robot

The Raspberry Pi on the robot runs everything (ROS, SLAM, Nav2 and the website); you open
the site from a laptop or phone on the same Wi-Fi. The real base uses the same topics as the
sim (`diff_cont`, `twist_mux`, `/odom`, `/scan`), so every page of the website works the same.

```
Website ── nova_dashboard (Pi) ── twist_mux ── diff_cont ── ros2_control + diffdrive_arduino
                                                             │ USB serial, 57600
                                                  Arduino (NovaArduinoBridge) ── TB6612FNG ── motors
                                                             └── encoders (PID on the Arduino)
                   RPLidar ── rplidar_ros ── /scan ── SLAM / AMCL / Nav2
```

### 1. Wire and flash the Arduino (Uno / Nano)

`firmware/NovaArduinoBridge` is the upstream ros_arduino_bridge firmware with a TB6612FNG
driver added (`TB6612_MOTOR_DRIVER` in `NovaArduinoBridge.ino`, pins in `motor_driver.h`):

| TB6612FNG | Arduino | | Encoders | Arduino |
| --- | --- | --- | --- | --- |
| PWMA | D6 | | left A / B | D2 / D3 |
| AIN1 / AIN2 | D7 / D8 | | right A / B | A4 / A5 |
| PWMB | D9 | | | |
| BIN1 / BIN2 | D10 / D11 | | | |
| STBY | D4 | | | |
| VCC | 5 V | | | |
| VM | motor battery (+), GND shared with the Arduino | | | |

Motor A (AO1/AO2) is the left wheel, motor B (BO1/BO2) the right. Open
`firmware/NovaArduinoBridge/NovaArduinoBridge.ino` in the Arduino IDE and upload it.

### 2. Install on the Pi (Ubuntu 24.04 Server)

```bash
git clone --recurse-submodules git@github.com:thirun30-dev/nova_bot.git ~/nova_ws/src/nova_bot
bash ~/nova_ws/src/nova_bot/scripts/setup_ubuntu.sh --robot    # ROS base, drivers, build, nova_run
```

`--robot` skips Gazebo and RViz and adds you to the `dialout` group (log in again once).
It also links the ros2_control hardware plugin, `diffdrive_arduino` (submodule in
`external/`, `humble` branch; builds on Jazzy), into the workspace.

### 3. Calibrate

With the robot stack stopped and the wheels off the ground:

```bash
nova_run encoders --spin 120   # both wheels forward 2 s; checks motor and encoder directions
nova_run encoders              # turn each wheel exactly one revolution by hand: the count is the CPR
```

Then measure the wheels and save the robot's settings:

- `config/my_controllers.yaml`: `wheel_radius` and `wheel_separation` (centre to centre of the
  wheels), in metres
- `~/.config/nova/robot.env` (read by `nova_run`; every line is optional):

  ```bash
  NOVA_CPR=1440                 # your measured counts per wheel revolution
  NOVA_LIDAR_BAUD=115200        # RPLidar A1/A2M8 115200, A2M12 256000, C1 460800
  NOVA_ARDUINO=/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0   # if auto-detect picks wrong
  NOVA_LIDAR=/dev/serial/by-id/usb-Silicon_Labs_CP2102_..._port0
  NOVA_CAMERA=true              # USB camera on the Pi
  ```

`nova_run` finds the two USB-serial devices in `/dev/serial/by-id` on its own: the RPLidar has
a Silicon Labs CP210x chip, the Arduino is the other one.

### 4. Run

```bash
nova_run --real                # on the Pi (e.g. over ssh): robot + SLAM + Nav2 + website
nova_run --real nav            # on the newest saved map
nova_run --real web            # website only; start the robot from Robot Stack
```

It prints `http://<pi-ip>:8080/?token=…`; open that on the laptop. The token is created once
and kept in `~/.config/nova/token` (or set `NOVA_TOKEN`), so the link can be bookmarked.
Add `--local` to keep the site on the Pi only. Keep a hand near the **E-STOP** the first few
drives, and start with low speeds on the Drive page.

To test one piece at a time: `ros2 launch nova_bot rplidar.launch.py lidar_port:=...` for the
lidar, or the `serial_motor_demo` GUI (`ros2 run serial_motor_demo driver` / `gui`) for the
motors, which talks to the same firmware.
