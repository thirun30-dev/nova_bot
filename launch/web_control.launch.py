import os

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description():
    """Only the Nova web dashboard. Everything else (robot / sim, SLAM, localization,
    Nav2) is started and stopped from the page's "Robot stack" panel.

      ros2 launch nova_bot web_control.launch.py                      # sim, http://localhost:8080
      ros2 launch nova_bot web_control.launch.py host:=0.0.0.0 token:=<secret>
      ros2 launch nova_bot web_control.launch.py robot:=real use_sim_time:=false
    """
    arg = LaunchConfiguration
    return LaunchDescription([
        DeclareLaunchArgument('robot', default_value='sim',
                              description="'sim' (Gazebo), 'real' (launch_robot.launch.py) or "
                                          "'none' (robot base brought up elsewhere)"),
        DeclareLaunchArgument('use_sim_time', default_value='true',
                              description="true for the Gazebo sim, false on the real robot"),
        DeclareLaunchArgument('host', default_value='127.0.0.1',
                              description="Bind address; '0.0.0.0' exposes it on the LAN"),
        DeclareLaunchArgument('port', default_value='8080'),
        DeclareLaunchArgument('token', default_value='',
                              description='Access token (required when host is not localhost)'),
        DeclareLaunchArgument('world', default_value='obstacles.world',
                              description='Default Gazebo world in nova_bot/worlds'),
        DeclareLaunchArgument('map_dir', default_value=os.path.expanduser('~/hiro_ws/maps'),
                              description='Where maps (and stations.yaml) are saved and loaded'),
        DeclareLaunchArgument('autostart', default_value='',
                              description="Preset to start right away: '' (none), 'mapping' "
                                          "(robot + SLAM + Nav2) or 'navigation' (robot + AMCL + Nav2)"),
        DeclareLaunchArgument('map', default_value='',
                              description="Saved map name in map_dir for autostart:=navigation"),
        DeclareLaunchArgument('headless', default_value='false',
                              description='Autostart Gazebo without its GUI'),
        Node(
            package='nova_bot',
            executable='nova_dashboard.py',
            parameters=[{
                'use_sim_time': ParameterValue(arg('use_sim_time'), value_type=bool),
                'host': arg('host'),
                'port': ParameterValue(arg('port'), value_type=int),
                'token': ParameterValue(arg('token'), value_type=str),
                'robot_launch': arg('robot'),
                'default_world': arg('world'),
                'map_dir': arg('map_dir'),
                'autostart': ParameterValue(arg('autostart'), value_type=str),
                'autostart_map': ParameterValue(arg('map'), value_type=str),
                'autostart_headless': ParameterValue(arg('headless'), value_type=bool),
            }],
            output='screen',
            # on Ctrl-C the dashboard first stops the launches it started (Gazebo can take ~15 s)
            sigterm_timeout='30',
        ),
    ])
