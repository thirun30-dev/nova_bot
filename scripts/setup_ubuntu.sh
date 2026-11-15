#!/usr/bin/env bash
# One-time setup for the Nova workspace on Ubuntu 24.04 (ROS 2 Jazzy + Gazebo Harmonic).
# Run from anywhere:  bash src/nova_bot/scripts/setup_ubuntu.sh
#                     bash src/nova_bot/scripts/setup_ubuntu.sh --robot   (robot computer:
#                     ROS base without desktop/Gazebo/RViz, serial port access)
#                     bash src/nova_bot/scripts/setup_ubuntu.sh --cloudflared   (only install
#                     cloudflared into ~/.local/bin, for nova_run --tunnel; no sudo)
# Safe to re-run: it skips the ROS install if /opt/ros/jazzy already exists.
set -euo pipefail

ROBOT=false
[ "${1:-}" = "--robot" ] && ROBOT=true

install_cloudflared() {
    case "$(uname -m)" in
        x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; armv7l|armhf) arch=arm ;;
        *) echo "cloudflared: unsupported CPU $(uname -m)" >&2; return 1 ;;
    esac
    mkdir -p "$HOME/.local/bin"
    echo "==> Installing cloudflared ($arch) into ~/.local/bin"
    curl -fL --progress-bar -o "$HOME/.local/bin/cloudflared.tmp" \
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$arch"
    chmod +x "$HOME/.local/bin/cloudflared.tmp"
    mv "$HOME/.local/bin/cloudflared.tmp" "$HOME/.local/bin/cloudflared"
    "$HOME/.local/bin/cloudflared" --version
}
if [ "${1:-}" = "--cloudflared" ]; then install_cloudflared; exit; fi

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
    if $ROBOT; then
        sudo apt install -y "ros-$ROS_DISTRO_NAME-ros-base"
    else
        sudo apt install -y "ros-$ROS_DISTRO_NAME-desktop"
    fi
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

echo "==> Linking the packages in nova_bot/external into the workspace"
git -C "$PKG_DIR" submodule update --init
for d in "$PKG_DIR"/external/*/; do
    name="$(basename "$d")"
    # colcon does not look inside a package (nova_bot), so ROS packages there get a src/ link
    if [ -n "$(find "$d" -maxdepth 2 -name package.xml -print -quit)" ] && [ ! -e "$WS_DIR/src/$name" ]; then
        ln -s "nova_bot/external/$name" "$WS_DIR/src/$name"
        echo "    src/$name -> nova_bot/external/$name"
    fi
done

echo "==> Installing nova_bot dependencies (from package.xml)"
cd "$WS_DIR"
if $ROBOT; then
    # the robot computer runs no simulation or RViz
    rosdep install --from-paths src --ignore-src -r -y \
        --skip-keys "ros_gz_sim ros_gz_bridge ros_gz_image gz_ros2_control rviz2"
    if ! id -nG "$USER" | grep -qw dialout; then
        echo "==> Adding $USER to 'dialout' for the Arduino and lidar serial ports (log in again after)"
        sudo usermod -aG dialout "$USER"
    fi
else
    rosdep install --from-paths src --ignore-src -r -y
fi

echo "==> Building workspace at $WS_DIR"
colcon build --symlink-install

echo "==> Installing the nova_run command into ~/.local/bin"
mkdir -p "$HOME/.local/bin"
ln -sf "$PKG_DIR/scripts/nova_run" "$HOME/.local/bin/nova_run"

cat <<EOF

Done. In every new terminal run:
    source /opt/ros/$ROS_DISTRO_NAME/setup.bash
    source $WS_DIR/install/setup.bash

$($ROBOT && echo "Robot computer: flash firmware/NovaArduinoBridge, plug in the Arduino and RPLidar, then:
    nova_run encoders        # measure the encoder CPR (see README, Real robot)
    nova_run --real          # robot + website; open the printed link from your laptop
")
Then start the simulation and open the web dashboard with one command:
    nova_run                 # map a new area   (nova_run --help for all options)
    nova_run nav             # work on the newest saved map
(If 'nova_run' is not found, open a new terminal: ~/.local/bin joins PATH at login.)
EOF
