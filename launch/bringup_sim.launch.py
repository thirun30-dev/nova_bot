import math
import os

from ament_index_python.packages import get_package_share_directory

from launch import LaunchDescription
from launch.actions import (DeclareLaunchArgument, ExecuteProcess, GroupAction,
                            IncludeLaunchDescription, OpaqueFunction, TimerAction)
from launch.conditions import IfCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import EqualsSubstitution, LaunchConfiguration

from launch_ros.actions import Node


def generate_launch_description():
    """Whole Nova AMR in simulation, in one command.

    Gazebo + controllers + velocity chain, then either SLAM (mode:=slam, default)
    or AMCL on a saved map (mode:=localization), then Nav2 and RViz.

      ros2 launch nova_bot bringup_sim.launch.py
      ros2 launch nova_bot bringup_sim.launch.py mode:=localization
      ros2 launch nova_bot bringup_sim.launch.py mode:=localization map:=/path/to/map.yaml
    """

    pkg_share = get_package_share_directory('nova_bot')
    launch_dir = os.path.join(pkg_share, 'launch')

    def include(name, args, condition=None):
        return IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(launch_dir, name)),
            launch_arguments=args.items(),
            condition=condition)

    mode = LaunchConfiguration('mode')

    sim = include('launch_sim.launch.py', {'world': LaunchConfiguration('world')})

    slam = include('slam.launch.py', {'use_sim_time': 'true'},
                   IfCondition(EqualsSubstitution(mode, 'slam')))

    localization = include('localization.launch.py', {
        'use_sim_time': 'true',
        'map': LaunchConfiguration('map'),
    }, IfCondition(EqualsSubstitution(mode, 'localization')))

    # AMCL publishes map->odom only once it has a pose. The robot spawns at the origin,
    # so give it that pose as soon as AMCL subscribes (Nav2's costmaps wait on map->base_link).
    def initial_pose_cmd(context):
        x, y, yaw = (float(LaunchConfiguration(k).perform(context)) for k in ('x', 'y', 'yaw'))
        msg = ('{header: {frame_id: map}, pose: {pose: {position: {x: %f, y: %f}, '
               'orientation: {z: %f, w: %f}}, covariance: [0.25,0,0,0,0,0, 0,0.25,0,0,0,0, '
               '0,0,0,0,0,0, 0,0,0,0,0,0, 0,0,0,0,0,0, 0,0,0,0,0,0.07]}}'
               % (x, y, math.sin(yaw / 2), math.cos(yaw / 2)))
        return [ExecuteProcess(
            cmd=['ros2', 'topic', 'pub', '--wait-matching-subscriptions', '1', '--times', '3',
                 '/initialpose', 'geometry_msgs/msg/PoseWithCovarianceStamped', msg],
            output='log')]

    initial_pose = GroupAction(
        [OpaqueFunction(function=initial_pose_cmd)],
        condition=IfCondition(EqualsSubstitution(mode, 'localization')))

    navigation = include('navigation.launch.py', {'use_sim_time': 'true'},
                         IfCondition(LaunchConfiguration('nav')))

    dashboard = Node(
        package='nova_bot',
        executable='nova_dashboard.py',
        parameters=[{'use_sim_time': True,
                     'host': LaunchConfiguration('dashboard_host'),
                     'port': LaunchConfiguration('dashboard_port')}],
        condition=IfCondition(LaunchConfiguration('dashboard')),
        output='screen',
    )

    rviz = Node(
        package='rviz2',
        executable='rviz2',
        # Package copy of Nav2's default view (the /opt/ros one is read-only, and RViz
        # aborts on exit when it can't save its config there).
        arguments=['-d', os.path.join(pkg_share, 'config', 'nav2_view.rviz')],
        parameters=[{'use_sim_time': True}],
        condition=IfCondition(LaunchConfiguration('rviz')),
        output='log',
    )

    return LaunchDescription([
        DeclareLaunchArgument(
            'world', default_value=os.path.join(pkg_share, 'worlds', 'obstacles.world'),
            description='Gazebo world file'),
        DeclareLaunchArgument(
            'mode', default_value='slam',
            description="'slam' (build a map while driving) or 'localization' (AMCL on a saved map)"),
        DeclareLaunchArgument(
            'map', default_value=os.path.expanduser('~/nova_ws/maps/my_map.yaml'),
            description='Saved map, used when mode:=localization'),
        DeclareLaunchArgument('nav', default_value='true', description='Start Nav2'),
        DeclareLaunchArgument('x', default_value='0.0', description='AMCL initial x (localization)'),
        DeclareLaunchArgument('y', default_value='0.0', description='AMCL initial y (localization)'),
        DeclareLaunchArgument('yaw', default_value='0.0', description='AMCL initial yaw (localization)'),
        DeclareLaunchArgument('rviz', default_value='true', description='Start RViz'),
        DeclareLaunchArgument('dashboard', default_value='true',
                              description='Start the web dashboard (http://localhost:8080)'),
        DeclareLaunchArgument('dashboard_host', default_value='127.0.0.1',
                              description="Dashboard bind address; '0.0.0.0' exposes it on the LAN"),
        DeclareLaunchArgument('dashboard_port', default_value='8080', description='Dashboard port'),
        sim,
        # Give Gazebo time to spawn the robot and start the controllers before
        # the map/odom consumers come up.
        TimerAction(period=8.0, actions=[slam, localization, initial_pose]),
        TimerAction(period=12.0, actions=[navigation, rviz, dashboard]),
    ])
