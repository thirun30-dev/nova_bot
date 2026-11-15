import os

from ament_index_python.packages import get_package_share_directory

from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription, DeclareLaunchArgument
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, PythonExpression

from launch_ros.actions import Node


def generate_launch_description():

    package_name = 'nova_bot'
    pkg_share = get_package_share_directory(package_name)

    # robot_state_publisher with the simulated (gz_ros2_control) hardware
    rsp = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([os.path.join(pkg_share, 'launch', 'rsp.launch.py')]),
        launch_arguments={'use_sim_time': 'true', 'use_ros2_control': 'true'}.items()
    )

    # Gamepad teleop -> /cmd_vel_joy (harmless if no gamepad is plugged in)
    joystick = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([os.path.join(pkg_share, 'launch', 'joystick.launch.py')]),
        launch_arguments={'use_sim_time': 'true'}.items()
    )

    # Velocity command chain (twist_mux >= 4.5 is TwistStamped-only):
    #   /cmd_vel (Nav2, keyboard)  -> twist_stamper -> /cmd_vel_stamped     ─┐
    #   /cmd_vel_joy (gamepad)     -> twist_stamper -> /cmd_vel_joy_stamped ─┴─ twist_mux
    #     -> /diff_cont/cmd_vel (TwistStamped, what Jazzy's diff_drive_controller wants)
    twist_mux_params = os.path.join(pkg_share, 'config', 'twist_mux.yaml')
    twist_mux = Node(
        package='twist_mux',
        executable='twist_mux',
        parameters=[twist_mux_params, {'use_sim_time': True}],
        remappings=[('/cmd_vel_out', '/diff_cont/cmd_vel')]
    )

    stamp_nav = Node(
        package='twist_stamper',
        executable='twist_stamper',
        name='stamp_cmd_vel',
        parameters=[{'use_sim_time': True, 'frame_id': 'base_link'}],
        remappings=[('/cmd_vel_in', '/cmd_vel'),
                    ('/cmd_vel_out', '/cmd_vel_stamped')]
    )

    stamp_joy = Node(
        package='twist_stamper',
        executable='twist_stamper',
        name='stamp_cmd_vel_joy',
        parameters=[{'use_sim_time': True, 'frame_id': 'base_link'}],
        remappings=[('/cmd_vel_in', '/cmd_vel_joy'),
                    ('/cmd_vel_out', '/cmd_vel_joy_stamped')]
    )

    # Nav2's default configuration expects wheel odometry on /odom
    odom_relay = Node(
        package='topic_tools',
        executable='relay',
        name='odom_relay',
        parameters=[{'input_topic': '/diff_cont/odom',
                     'output_topic': '/odom',
                     'use_sim_time': True}]
    )

    default_world = os.path.join(pkg_share, 'worlds', 'empty.world')
    world = LaunchConfiguration('world')
    world_arg = DeclareLaunchArgument(
        'world',
        default_value=default_world,
        description='World to load'
    )

    # headless:=true runs only the Gazebo server (no GUI window), e.g. when the robot is
    # driven from the web dashboard. The camera still renders (--headless-rendering).
    headless_arg = DeclareLaunchArgument(
        'headless', default_value='false', description='Run Gazebo without its GUI')
    gz_flags = PythonExpression(["'-r -s --headless-rendering -v4 ' if '",
                                 LaunchConfiguration('headless'), "' == 'true' else '-r -v4 '"])

    gazebo = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([os.path.join(
            get_package_share_directory('ros_gz_sim'), 'launch', 'gz_sim.launch.py')]),
        launch_arguments={'gz_args': [gz_flags, world], 'on_exit_shutdown': 'true'}.items()
    )

    spawn_entity = Node(
        package='ros_gz_sim',
        executable='create',
        arguments=['-topic', 'robot_description',
                   '-name', 'nova',
                   '-z', '0.1'],
        output='screen'
    )

    diff_drive_spawner = Node(
        package='controller_manager',
        executable='spawner',
        arguments=['diff_cont'],
    )

    joint_broad_spawner = Node(
        package='controller_manager',
        executable='spawner',
        arguments=['joint_broad'],
    )

    bridge_params = os.path.join(pkg_share, 'config', 'gz_bridge.yaml')
    ros_gz_bridge = Node(
        package='ros_gz_bridge',
        executable='parameter_bridge',
        arguments=[
            '--ros-args',
            '-p',
            f'config_file:={bridge_params}',
        ]
    )

    ros_gz_image_bridge = Node(
        package='ros_gz_image',
        executable='image_bridge',
        arguments=['/camera/image_raw']
    )

    return LaunchDescription([
        rsp,
        joystick,
        stamp_nav,
        stamp_joy,
        twist_mux,
        odom_relay,
        world_arg,
        headless_arg,
        gazebo,
        spawn_entity,
        diff_drive_spawner,
        joint_broad_spawner,
        ros_gz_bridge,
        ros_gz_image_bridge
    ])
