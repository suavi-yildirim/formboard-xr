import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stationPose, fallbackPoint, carPose, floorPoint, TABLE_HEIGHT_M } from '../src/core/placement.js';

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

test('placement: the car stands on the floor with its engine end towards the user', () => {
  const head = { x: 0, y: 1.6, z: 0 };
  const c = carPose({ x: 0, y: 0.01, z: -3 }, { x: 0, y: 1, z: 0 }, head);
  near(c.yaw, -Math.PI / 2); // same as in VR: vehicle +x (engine end) turned to +z, towards the user
  const engineEnd = { x: Math.cos(c.yaw), z: -Math.sin(c.yaw) }; // vehicle +x after the turn
  assert.ok(engineEnd.z > 0.99);
  assert.equal(carPose({ x: 0, y: 0.75, z: -1 }, { x: 0, y: 1, z: 0 }, head), null); // a table is not the floor
});

test('placement: without a floor scan the gaze meets the floor, 1 to 6 m away', () => {
  const head = { x: 0, y: 1.6, z: 0 };
  const p = floorPoint(head, { x: 0, y: -0.5, z: -0.866 });
  near(p.y, 0);
  near(Math.hypot(p.x, p.z), 1.6 / 0.5 * 0.866);
  assert.ok(Math.hypot(...Object.values(floorPoint(head, { x: 0, y: -0.9, z: -0.1 })).filter((_, i) => i !== 1)) >= 1 - 1e-9); // too close: pushed to 1 m
  assert.equal(floorPoint(head, { x: 0, y: 0.1, z: -1 }), null);
});
