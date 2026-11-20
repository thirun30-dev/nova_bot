// Nova's body, from description/robot_core.xacro + lidar.xacro, in base_link coordinates
// (metres; x forward, y left, z up; base_link = midpoint of the drive-wheel axle).
// Used for the robot drawn on the 2D map and the 3D model.

export const WHEEL_R = 0.033;            // wheel_radius; the floor is at z = -WHEEL_R

export const ROBOT = {
  // chassis box: chassis link is wheel_offset_x behind base_link, wheel_offset_z below it
  chassis: { x0: -0.226, x1: -0.226 + 0.335, halfW: 0.265 / 2, z0: -0.01, h: 0.138 },
  wheel: { x: 0, y: 0.1485, r: WHEEL_R, w: 0.026 },
  caster: { x: -0.226 + 0.075, r: 0.01 },
  // RPLidar puck on a post: laser_joint xyz 0.122 0 0.212 from the chassis link
  lidar: { x: -0.226 + 0.122, z: -0.01 + 0.212, r: 0.05, h: 0.04 },
} as const;
