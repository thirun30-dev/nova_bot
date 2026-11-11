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
/cmd_vel (Nav2, keyboard) ─┐
/cmd_vel_joy (gamepad) ────┴─ twist_mux ─ /diff_cont/cmd_vel_unstamped ─ twist_stamper ─ /diff_cont/cmd_vel
```

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

## Real robot (not done yet)

`launch/launch_robot.launch.py`, `launch/rplidar.launch.py` and the `RealRobot` block in
`description/ros2_control.xacro` are upstream placeholders: they assume an Arduino motor
controller (`diffdrive_arduino`, built from source) on `/dev/ttyUSB0` and an RPLidar.
They need Nova's actual motor driver, encoder counts, serial ports and lidar model.
