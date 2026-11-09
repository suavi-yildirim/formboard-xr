import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cavityLayout, insertTarget, CAVITY_PITCH_MM } from '../src/core/cavity.js';
import { InsertAttempt, PUSH_MM } from '../src/core/insert.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url)));
const types = (evs) => evs.map((e) => e.type);

test('cavity layout: up to 4 in one row, more in two rows, top row first, left to right', () => {
  const four = cavityLayout(['1', '2', '3', '4']);
  assert.equal(new Set(four.cavities.map((c) => c.y)).size, 1);
  assert.deepEqual(four.cavities.map((c) => c.n), ['1', '2', '3', '4']);
  assert.ok(four.cavities.every((c, i, a) => i === 0 || c.x > a[i - 1].x));

  const eight = cavityLayout(['1', '2', '3', '4', '5', '6', '7', '8']);
  const top = eight.cavities.slice(0, 4), bottom = eight.cavities.slice(4);
  assert.ok(top.every((c) => c.y > 0) && bottom.every((c) => c.y < 0));
  assert.equal(eight.cavities[1].x - eight.cavities[0].x, CAVITY_PITCH_MM);

  const five = cavityLayout(['1', '2', '3', '4', '5']);
  assert.deepEqual([five.cavities.filter((c) => c.y > 0).length, five.cavities.filter((c) => c.y < 0).length], [3, 2]);
});

test('cavity layout: centred, the face is one pitch larger than the cavities', () => {
  const l = cavityLayout(['1', '2', '3', '4', '5', '6']);
  const xs = l.cavities.map((c) => c.x);
  assert.equal(Math.min(...xs) + Math.max(...xs), 0);
  assert.equal(l.w, 3 * CAVITY_PITCH_MM + CAVITY_PITCH_MM);
  assert.equal(l.h, 2 * CAVITY_PITCH_MM + CAVITY_PITCH_MM);
});

test('insert target: only wire ends into connectors with 2 or more cavities', () => {
  const h = load('vw_wiper.json');
  const steps = h.wires.map((w) => insertTarget(h, w)).filter(Boolean);
  assert.equal(steps.length, 6);
  const w70 = h.wires.find((w) => w.id === 'W70');
  assert.deepEqual(insertTarget(h, w70), { node: 'XA.E.1', cavity: '6', numbers: ['1', '2', '3', '4', '5', '6', '7', '8'] });
  const vw = load('vw_movo.json');
  const glow = vw.wires.find((w) => w.id === 'W15');
  assert.equal(insertTarget(vw, glow), null);
});

const layout = cavityLayout(['1', '2', '3', '4', '5', '6', '7', '8']);
const at = (n) => layout.cavities.find((c) => c.n === n);

test('insert: push through the target cavity from the front', () => {
  const a = new InsertAttempt(layout, '6');
  assert.deepEqual(types(a.update(at('6'), true, 20)), ['grab', 'hover']);
  assert.deepEqual(types(a.update(at('6'), true, -PUSH_MM - 1)), ['inserted']);
  assert.ok(a.done);
  assert.equal(a.errors, 0);
  assert.deepEqual(a.update(at('6'), false, 20), []);
});

test('insert: a wrong cavity counts once per push, then the hand must come back out', () => {
  const a = new InsertAttempt(layout, '6');
  a.update(at('2'), true, 20);
  assert.deepEqual(types(a.update(at('2'), true, -PUSH_MM - 1)), ['wrong']);
  assert.equal(a.update(at('2'), true, -PUSH_MM - 5).length, 0);
  assert.equal(a.errors, 1);
  a.update(at('3'), true, 10); // back out in front of the face
  assert.equal(a.update(at('3'), true, -PUSH_MM - 1)[0].expected, '6');
  assert.equal(a.errors, 2);
  a.update(at('6'), true, 10);
  assert.deepEqual(types(a.update(at('6'), true, -PUSH_MM - 1)), ['inserted']);
});

test('insert: arriving from behind the face or between cavities is not a push', () => {
  const a = new InsertAttempt(layout, '6');
  a.update(at('2'), true, -30);
  assert.deepEqual(a.update(at('2'), true, -20), []);
  a.update({ x: at('2').x + CAVITY_PITCH_MM / 2, y: 0 }, true, 10);
  assert.deepEqual(types(a.update({ x: at('2').x + CAVITY_PITCH_MM / 2, y: 0 }, true, -20)), []);
  assert.equal(a.errors, 0);
});

test('insert: release keeps progress, a new grab continues', () => {
  const a = new InsertAttempt(layout, '1');
  a.update(at('1'), true, 20);
  assert.deepEqual(types(a.update(null, false, 0)), ['release']);
  assert.ok(!a.done && !a.holding);
  assert.deepEqual(types(a.update(at('1'), true, 20)), ['grab', 'hover']);
  assert.deepEqual(types(a.update(at('1'), true, -PUSH_MM - 1)), ['inserted']);
});
