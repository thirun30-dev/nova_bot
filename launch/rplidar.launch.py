from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description():
    """RPLidar on its own, to test it (launch_robot.launch.py starts it with the robot):

      ros2 launch nova_bot rplidar.launch.py lidar_port:=/dev/ttyUSB1          # A1 / A2M8
      ros2 launch nova_bot rplidar.launch.py lidar_port:=/dev/ttyUSB1 lidar_baud:=460800   # C1
    """
    arg = LaunchConfiguration
    return LaunchDescription([
        DeclareLaunchArgument('lidar_port', default_value='/dev/ttyUSB1'),
        DeclareLaunchArgument('lidar_baud', default_value='115200',
                              description='A1/A2M8 115200, A2M12 256000, C1 460800'),
        DeclareLaunchArgument('lidar_scan_mode', default_value=''),
        Node(
            package='rplidar_ros',
            executable='rplidar_node',
            name='rplidar_node',
            output='screen',
            parameters=[{
                'serial_port': arg('lidar_port'),
                'serial_baudrate': ParameterValue(arg('lidar_baud'), value_type=int),
                'frame_id': 'laser_frame',
                'angle_compensate': True,
                'scan_mode': arg('lidar_scan_mode'),
            }]
        ),
    ])
