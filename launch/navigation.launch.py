import os

from ament_index_python.packages import get_package_share_directory

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration


def generate_launch_description():
    """Nav2 planning/control stack (run alongside slam.launch.py or localization.launch.py).

    Uses the Nav2 launch file and default parameters of the installed distro, so
    it always matches the installed Nav2 version. To tune, copy
    /opt/ros/$ROS_DISTRO/share/nav2_bringup/params/nav2_params.yaml into this
    package's config/ folder and pass it as params_file:=...
    """

    nav2_bringup = get_package_share_directory('nav2_bringup')
    default_params = os.path.join(
        get_package_share_directory('hiro_bot'), 'config', 'nav2_params.yaml')

    navigation = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([os.path.join(
            nav2_bringup, 'launch', 'navigation_launch.py')]),
        launch_arguments={
            'use_sim_time': LaunchConfiguration('use_sim_time'),
            'params_file': LaunchConfiguration('params_file'),
        }.items()
    )

    return LaunchDescription([
        DeclareLaunchArgument(
            'use_sim_time', default_value='true',
            description='Use simulation (Gazebo) clock if true'),
        DeclareLaunchArgument(
            'params_file', default_value=default_params,
            description='Nav2 parameters file'),
        navigation,
    ])
