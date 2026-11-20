#!/usr/bin/env python3
"""/joy_raw -> /joy, holding each axis at 0 until it has really moved once.

Some gamepads (the ShanWan/EVOFOX "Android GamePad" among them) report every axis as 1.0
(fully pushed) until that stick is first touched. With teleop_twist_joy that means holding
the deadman button right after startup drives the robot at full speed. An axis is trusted
once it reports a value different from its first one; until then it is published as 0.
"""
import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import Joy


class JoyGuard(Node):
    def __init__(self):
        super().__init__('joy_guard')
        self.first, self.live = None, []
        self.pub = self.create_publisher(Joy, '/joy', 10)
        self.create_subscription(Joy, '/joy_raw', self.on_joy, qos_profile_sensor_data)

    def on_joy(self, m):
        if self.first is None or len(self.first) != len(m.axes):
            self.first, self.live = list(m.axes), [False] * len(m.axes)
        axes = []
        for i, v in enumerate(m.axes):
            if not self.live[i] and abs(v - self.first[i]) > 0.05:
                self.live[i] = True
            axes.append(v if self.live[i] else 0.0)
        m.axes = axes
        self.pub.publish(m)


def main():
    rclpy.init()
    node = JoyGuard()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, rclpy.executors.ExternalShutdownException):
        pass
    node.destroy_node()
    rclpy.try_shutdown()


if __name__ == '__main__':
    main()
