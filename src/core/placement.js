// Where things go in mixed reality: the workstation (board, panel) on a real table, the car on the
// floor, both turned towards the user. Plain {x, y, z} objects, no three.js, so this can be unit tested.

export const TABLE_HEIGHT_M = 0.74; // fallback when the headset finds no surface (no Space Setup)
export const FLOOR_MAX_M = 0.4; // a surface lower than this is the floor
const MIN_UP = 0.85; // a surface counts as horizontal when its normal points this much upwards

// Turn about the vertical axis that makes an object's +z point from `point` to the user's head.
export function facingYaw(point, head) {
  return Math.atan2(head.x - point.x, head.z - point.z);
}

// Pose of the workstation on a surface point: the origin sits on the surface, the station's +z
// (towards the user) points at the head. Returns null for walls and other steep surfaces.
export function stationPose(point, normal, head) {
  if (normal && normal.y < MIN_UP) return null;
  return { x: point.x, y: point.y, z: point.z, yaw: facingYaw(point, head) };
}

// Pose of the car on the floor, its engine end (the vehicle's +x, where the ignition harness sits)
// towards the user. Returns null for anything that is not the floor (tables, walls).
export function carPose(point, normal, head) {
  if (normal && normal.y < MIN_UP) return null;
  if (point.y > FLOOR_MAX_M) return null;
  return { x: point.x, z: point.z, yaw: facingYaw(point, head) - Math.PI / 2 };
}

// Without a detected surface: where the gaze ray meets a plane at table height. The point is kept
// between 0.3 and 1.2 m in front of the user; null when looking up.
export function fallbackPoint(origin, dir, height = TABLE_HEIGHT_M) {
  if (dir.y > -0.05) return null;
  let t = (height - origin.y) / dir.y;
  const flat = Math.hypot(dir.x, dir.z) || 1e-6;
  t = Math.min(Math.max(t, 0.3 / flat), 1.2 / flat);
  return { x: origin.x + dir.x * t, y: height, z: origin.z + dir.z * t };
}

// Without a detected floor: where the gaze meets the floor (y = 0), kept between 1 and 6 m in front
// of the user (a car needs room). Null when looking up.
export function floorPoint(origin, dir) {
  if (dir.y > -0.02) return null;
  let t = -origin.y / dir.y;
  const flat = Math.hypot(dir.x, dir.z) || 1e-6;
  t = Math.min(Math.max(t, 1 / flat), 6 / flat);
  return { x: origin.x + dir.x * t, y: 0, z: origin.z + dir.z * t };
}
