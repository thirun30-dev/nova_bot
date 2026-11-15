import os

from ament_index_python.packages import get_package_share_directory

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.conditions import IfCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description():
    """Real Nova base: Arduino (NovaArduinoBridge firmware) through ros2_control +
    diffdrive_arduino, RPLidar, optional camera and gamepad. Same topics as launch_sim, so
    the dashboard, SLAM and Nav2 work unchanged.

      ros2 launch nova_bot launch_robot.launch.py serial_port:=/dev/ttyUSB0 lidar_port:=/dev/ttyUSB1

    Normally started by the dashboard (nova_run --real), which fills in the ports.
    """
    pkg_share = get_package_share_directory('nova_bot')
    arg = LaunchConfiguration

    rsp = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([os.path.join(pkg_share, 'launch', 'rsp.launch.py')]),
        launch_arguments={'use_sim_time': 'false', 'use_ros2_control': 'true',
                          'serial_port': arg('serial_port'), 'baud_rate': arg('baud_rate'),
                          'enc_counts_per_rev': arg('enc_counts_per_rev')}.items()
    )

    # ros2_control with the diffdrive_arduino hardware plugin. On Jazzy the controller
    # manager reads the URDF from the /robot_description topic (robot_state_publisher).
    controller_manager = Node(
        package='controller_manager',
        executable='ros2_control_node',
        parameters=[os.path.join(pkg_share, 'config', 'my_controllers.yaml')],
        remappings=[('~/robot_description', '/robot_description')],
        output='screen',
    )
    diff_drive_spawner = Node(package='controller_manager', executable='spawner',
                              arguments=['diff_cont'])
    joint_broad_spawner = Node(package='controller_manager', executable='spawner',
                               arguments=['joint_broad'])

    # Velocity chain, identical to the sim (see README): plain Twist inputs are stamped,
    # twist_mux picks by priority (/e_stop lock at 255) and drives diff_cont.
    twist_mux = Node(
        package='twist_mux', executable='twist_mux',
        parameters=[os.path.join(pkg_share, 'config', 'twist_mux.yaml')],
        remappings=[('/cmd_vel_out', '/diff_cont/cmd_vel')]
    )
    stamp_nav = Node(
        package='twist_stamper', executable='twist_stamper', name='stamp_cmd_vel',
        parameters=[{'frame_id': 'base_link'}],
        remappings=[('/cmd_vel_in', '/cmd_vel'), ('/cmd_vel_out', '/cmd_vel_stamped')]
    )
    stamp_joy = Node(
        package='twist_stamper', executable='twist_stamper', name='stamp_cmd_vel_joy',
        parameters=[{'frame_id': 'base_link'}],
        remappings=[('/cmd_vel_in', '/cmd_vel_joy'), ('/cmd_vel_out', '/cmd_vel_joy_stamped')]
    )
    odom_relay = Node(
        package='topic_tools', executable='relay', name='odom_relay',
        parameters=[{'input_topic': '/diff_cont/odom', 'output_topic': '/odom'}]
    )

    # RPLidar A1 / A2M8: 115200, A2M12: 256000, C1: 460800
    lidar = Node(
        package='rplidar_ros', executable='rplidar_node', name='rplidar_node',
        condition=IfCondition(arg('lidar')),
        parameters=[{
            'serial_port': arg('lidar_port'),
            'serial_baudrate': ParameterValue(arg('lidar_baud'), value_type=int),
            'frame_id': 'laser_frame',
            'angle_compensate': True,
            'scan_mode': arg('lidar_scan_mode'),
        }],
        output='screen',
    )

    camera = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([os.path.join(pkg_share, 'launch', 'camera.launch.py')]),
        condition=IfCondition(arg('camera')),
    )
    joystick = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([os.path.join(pkg_share, 'launch', 'joystick.launch.py')]),
        launch_arguments={'use_sim_time': 'false'}.items(),
        condition=IfCondition(arg('joystick')),
    )

    return LaunchDescription([
        DeclareLaunchArgument('serial_port', default_value='/dev/ttyUSB0',
                              description='Arduino serial port'),
        DeclareLaunchArgument('baud_rate', default_value='57600',
                              description='Arduino baud rate (firmware BAUDRATE)'),
        DeclareLaunchArgument('enc_counts_per_rev', default_value='3436',
                              description='Encoder counts per wheel revolution'),
        DeclareLaunchArgument('lidar', default_value='true', description='Start the RPLidar'),
        DeclareLaunchArgument('lidar_port', default_value='/dev/ttyUSB1',
                              description='RPLidar serial port'),
        DeclareLaunchArgument('lidar_baud', default_value='115200',
                              description='RPLidar baud: A1/A2M8 115200, A2M12 256000, C1 460800'),
        DeclareLaunchArgument('lidar_scan_mode', default_value='',
                              description="RPLidar scan mode ('' = the lidar's default)"),
        DeclareLaunchArgument('camera', default_value='false', description='Start a USB camera'),
        DeclareLaunchArgument('joystick', default_value='false',
                              description='Gamepad plugged into the robot computer'),
        rsp,
        controller_manager,
        diff_drive_spawner,
        joint_broad_spawner,
        stamp_nav,
        stamp_joy,
        twist_mux,
        odom_relay,
        lidar,
        camera,
        joystick,
    ])
