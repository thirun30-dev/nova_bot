import os

from ament_index_python.packages import get_package_share_directory

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration


def generate_launch_description():
    """AMCL + map_server on a saved map (use instead of slam.launch.py once you have a map).

    Example: ros2 launch nova_bot localization.launch.py map:=$HOME/nova_ws/maps/my_map.yaml
    """

    nav2_bringup = get_package_share_directory('nav2_bringup')
    default_params = os.path.join(
        get_package_share_directory('nova_bot'), 'config', 'nav2_params.yaml')

    localization = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([os.path.join(
            nav2_bringup, 'launch', 'localization_launch.py')]),
        launch_arguments={
            'map': LaunchConfiguration('map'),
            'use_sim_time': LaunchConfiguration('use_sim_time'),
            'params_file': LaunchConfiguration('params_file'),
        }.items()
    )

    return LaunchDescription([
        DeclareLaunchArgument(
            'map',
            description='Full path to the saved map .yaml file'),
        DeclareLaunchArgument(
            'use_sim_time', default_value='true',
            description='Use simulation (Gazebo) clock if true'),
        DeclareLaunchArgument(
            'params_file', default_value=default_params,
            description='Nav2 parameters file'),
        localization,
    ])
