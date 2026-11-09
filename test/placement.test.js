import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stationPose, fallbackPoint, TABLE_HEIGHT_M } from '../src/core/placement.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('placement: on a table the station faces the user', () => {
  const p = stationPose({ x: 0, y: 0.75, z: -1 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1.6, z: 0 });
  near(p.y, 0.75); near(p.yaw, 0); // user straight ahead in +z
  const side = stationPose({ x: 1, y: 0.75, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1.6, z: 0 });
  near(side.yaw, -Math.PI / 2); // user to the station's -x: turned to face them
});

test('placement: walls are not tables', () => {
  assert.equal(stationPose({ x: 0, y: 1, z: -2 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1.6, z: 0 }), null);
});

test('placement: without a surface the gaze meets a plane at table height, within reach', () => {
  const p = fallbackPoint({ x: 0, y: 1.6, z: 0 }, { x: 0, y: -0.6, z: -0.8 });
  near(p.y, TABLE_HEIGHT_M);
  assert.ok(p.z < -0.3 && p.z >= -1.2 - 1e-9, `z ${p.z}`);
  assert.equal(fallbackPoint({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0.2, z: -1 }), null); // looking up
  const far = fallbackPoint({ x: 0, y: 1.6, z: 0 }, { x: 0, y: -0.1, z: -1 }); // nearly level gaze
  assert.ok(Math.hypot(far.x, far.z) <= 1.2 + 1e-9);
});
