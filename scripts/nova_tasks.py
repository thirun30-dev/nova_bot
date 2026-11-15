#!/usr/bin/env python3
"""Run and check Nova's AMR tasks against a running simulation.

Start the bot first (ros2 launch nova_bot bringup_sim.launch.py), then:

  python3 nova_tasks.py drive                 # Task 1: drive forward/turn, check odometry
  python3 nova_tasks.py map                   # Task 2: check SLAM is building /map
  python3 nova_tasks.py initpose 0 0 0        # set the AMCL pose (localization mode)
  python3 nova_tasks.py nav 3 0 [yaw]         # Task 3: Nav2 goal to (x, y)
  python3 nova_tasks.py patrol 3,0 3,-2 0,0   # Task 4: chain of waypoints
"""
import math
import sys
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, DurabilityPolicy, ReliabilityPolicy
from geometry_msgs.msg import Twist, PoseStamped, PoseWithCovarianceStamped
from nav_msgs.msg import Odometry, OccupancyGrid


def yaw_of(q):
    return math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))


def pose(nav, x, y, yaw=0.0):
    p = PoseStamped()
    p.header.frame_id = 'map'
    p.header.stamp = nav.get_clock().now().to_msg()
    p.pose.position.x, p.pose.position.y = float(x), float(y)
    p.pose.orientation.z, p.pose.orientation.w = math.sin(yaw / 2), math.cos(yaw / 2)
    return p


class Probe(Node):
    def __init__(self):
        super().__init__('nova_tasks', parameter_overrides=[
            rclpy.parameter.Parameter('use_sim_time', value=True)])
        self.odom = None
        self.map = None
        self.create_subscription(Odometry, '/odom', lambda m: setattr(self, 'odom', m), 10)
        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL,
                             reliability=ReliabilityPolicy.RELIABLE)
        self.create_subscription(OccupancyGrid, '/map', lambda m: setattr(self, 'map', m), latched)
        self.cmd = self.create_publisher(Twist, '/cmd_vel', 10)

    def spin_until(self, cond, timeout):
        end = time.time() + timeout
        while time.time() < end and not cond():
            rclpy.spin_once(self, timeout_sec=0.1)
        return cond()

    def xyyaw(self):
        p = self.odom.pose.pose
        return p.position.x, p.position.y, yaw_of(p.orientation)

    def send(self, vx, wz, seconds):
        t = Twist()
        t.linear.x, t.angular.z = float(vx), float(wz)
        end = time.time() + seconds
        while time.time() < end:
            self.cmd.publish(t)
            rclpy.spin_once(self, timeout_sec=0.05)
        self.cmd.publish(Twist())
        self.spin_until(lambda: False, 1.0)


def task_drive(n):
    assert n.spin_until(lambda: n.odom is not None, 10), 'no /odom'
    x0, y0, th0 = n.xyyaw()
    n.send(0.3, 0.0, 3.0)
    x1, y1, th1 = n.xyyaw()
    dist = math.hypot(x1 - x0, y1 - y0)
    n.send(0.0, 0.8, 2.0)
    _, _, th2 = n.xyyaw()
    turn = math.degrees(math.atan2(math.sin(th2 - th1), math.cos(th2 - th1)))
    n.send(0.0, -0.8, 2.0)   # turn back
    n.send(-0.3, 0.0, 3.0)   # and reverse to roughly where we started
    print(f'forward 3 s @0.3 m/s -> moved {dist:.2f} m; turn 2 s @0.8 rad/s -> {turn:.0f} deg')
    ok = dist > 0.5 and abs(turn) > 45
    print('DRIVE', 'PASS' if ok else 'FAIL')
    return ok


def task_map(n):
    ok = n.spin_until(lambda: n.map is not None, 15)
    if ok:
        m = n.map
        known = sum(1 for c in m.data if c >= 0)
        occ = sum(1 for c in m.data if c > 50)
        print(f'/map {m.info.width}x{m.info.height} @ {m.info.resolution} m, '
              f'{known} known cells, {occ} occupied')
        ok = known > 0 and occ > 0
    print('MAP', 'PASS' if ok else 'FAIL')
    return ok


def task_initpose(n, x, y, yaw):
    pub = n.create_publisher(PoseWithCovarianceStamped, '/initialpose', 10)
    n.spin_until(lambda: pub.get_subscription_count() > 0, 10)
    msg = PoseWithCovarianceStamped()
    msg.header.frame_id = 'map'
    msg.pose.pose = pose(n, x, y, yaw).pose
    msg.pose.covariance[0] = msg.pose.covariance[7] = 0.25
    msg.pose.covariance[35] = 0.07
    for _ in range(3):
        msg.header.stamp = n.get_clock().now().to_msg()
        pub.publish(msg)
        n.spin_until(lambda: False, 0.5)
    print(f'initial pose set to ({x}, {y}, {yaw})')
    return True


def run_nav(goals):
    from nav2_simple_commander.robot_navigator import BasicNavigator, TaskResult
    nav = BasicNavigator()
    nav.waitUntilNav2Active(localizer='bt_navigator')
    results = []
    for (x, y, yaw) in goals:
        t0 = time.time()
        nav.goToPose(pose(nav, x, y, yaw))
        while not nav.isTaskComplete():
            fb = nav.getFeedback()
            if fb and time.time() - t0 > 120:
                nav.cancelTask()
            rclpy.spin_once(nav, timeout_sec=0.5)
        res = nav.getResult()
        ok = res == TaskResult.SUCCEEDED
        print(f'goal ({x}, {y}) -> {res.name if hasattr(res, "name") else res} '
              f'in {time.time() - t0:.0f} s')
        results.append(ok)
    ok = all(results)
    print('NAV', 'PASS' if ok else 'FAIL')
    nav.destroy_node()
    return ok


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    rclpy.init()
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd in ('nav', 'patrol'):
        if cmd == 'nav':
            goals = [(float(args[0]), float(args[1]), float(args[2]) if len(args) > 2 else 0.0)]
        else:
            goals = [(*map(float, a.split(',')[:2]), 0.0) for a in args]
        ok = run_nav(goals)
    else:
        n = Probe()
        if cmd == 'drive':
            ok = task_drive(n)
        elif cmd == 'map':
            ok = task_map(n)
        elif cmd == 'initpose':
            ok = task_initpose(n, *(float(a) for a in (args + ['0', '0', '0'])[:3]))
        else:
            print(__doc__)
            ok = False
        n.destroy_node()
    rclpy.shutdown()
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
