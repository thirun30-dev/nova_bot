#!/usr/bin/env bash
# One-time setup for the Nova workspace on Ubuntu 24.04 (ROS 2 Jazzy + Gazebo Harmonic).
# Run from anywhere:  bash src/nova_bot/scripts/setup_ubuntu.sh
# Safe to re-run: it skips the ROS install if /opt/ros/jazzy already exists.
set -euo pipefail

ROS_DISTRO_NAME=jazzy
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WS_DIR="$(cd "$PKG_DIR/../.." && pwd)"

. /etc/os-release
if [ "${VERSION_CODENAME:-}" != "noble" ]; then
    echo "ROS 2 Jazzy needs Ubuntu 24.04 (noble); this is ${PRETTY_NAME:-unknown}." >&2
    exit 1
fi

if [ ! -f "/opt/ros/$ROS_DISTRO_NAME/setup.bash" ]; then
    echo "==> Installing ROS 2 $ROS_DISTRO_NAME"
    sudo apt update
    sudo apt install -y software-properties-common curl
    sudo add-apt-repository -y universe
    ver=$(curl -s https://api.github.com/repos/ros-infrastructure/ros-apt-source/releases/latest \
          | grep -F '"tag_name"' | awk -F'"' '{print $4}')
    curl -L -o /tmp/ros2-apt-source.deb \
        "https://github.com/ros-infrastructure/ros-apt-source/releases/download/${ver}/ros2-apt-source_${ver}.${VERSION_CODENAME}_all.deb"
    sudo dpkg -i /tmp/ros2-apt-source.deb
    sudo apt update
    sudo apt install -y "ros-$ROS_DISTRO_NAME-desktop"
fi

echo "==> Installing build tools"
sudo apt install -y python3-colcon-common-extensions python3-rosdep git

if [ ! -f /etc/ros/rosdep/sources.list.d/20-default.list ]; then
    sudo rosdep init
fi
rosdep update

set +u
source "/opt/ros/$ROS_DISTRO_NAME/setup.bash"
set -u

echo "==> Installing nova_bot dependencies (from package.xml)"
cd "$WS_DIR"
rosdep install --from-paths src --ignore-src -r -y

echo "==> Building workspace at $WS_DIR"
colcon build --symlink-install

echo "==> Installing the nova_run command into ~/.local/bin"
mkdir -p "$HOME/.local/bin"
ln -sf "$PKG_DIR/scripts/nova_run" "$HOME/.local/bin/nova_run"

cat <<EOF

Done. In every new terminal run:
    source /opt/ros/$ROS_DISTRO_NAME/setup.bash
    source $WS_DIR/install/setup.bash

Then start the simulation and open the web dashboard with one command:
    nova_run                 # map a new area   (nova_run --help for all options)
    nova_run nav             # work on the newest saved map
(If 'nova_run' is not found, open a new terminal: ~/.local/bin joins PATH at login.)
EOF
