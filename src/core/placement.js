// Where the workstation (board, panel) goes in mixed reality: on a real table, facing the user.
// Plain {x, y, z} objects, no three.js, so this can be unit tested.

export const TABLE_HEIGHT_M = 0.74; // fallback when the headset finds no surface (no Space Setup)
const MIN_UP = 0.85; // a surface counts as a table when its normal points this much upwards

// Pose of the workstation on a surface point: the origin sits on the surface, the station's +z
// (towards the user) points at the head. Returns null for walls and other steep surfaces.
export function stationPose(point, normal, head) {
  if (normal && normal.y < MIN_UP) return null;
  const dx = head.x - point.x, dz = head.z - point.z;
  return { x: point.x, y: point.y, z: point.z, yaw: Math.atan2(dx, dz) };
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
