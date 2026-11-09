import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCell, cellToMm } from '../src/core/grid.js';
import { validateHarness, variants, wiresForVariant, pegsFor, nodePositions, bundleSlots, wirePolyline } from '../src/core/harness.js';
import { RoutingAttempt, neighbourMap } from '../src/core/router.js';
import { Session, QA_ITEMS } from '../src/core/session.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url)));
const h = load('door.json');
const vw = load('vw_movo.json');
const pos = nodePositions(h);
const nb = neighbourMap(h.segments);

test('grid: cells map to centres in mm', () => {
  assert.deepEqual(parseCell('A1'), { col: 0, row: 0 });
  assert.deepEqual(cellToMm('H9', 50), { x: 375, y: 425 });
  assert.throws(() => parseCell('9H'));
});

test('harness: generated data is valid', () => {
  assert.deepEqual(validateHarness(h), []);
  assert.deepEqual(validateHarness(vw), []);
});

test('vw: real KBL harness keeps segment lengths and routes every connection', () => {
  assert.equal(vw.wires.length, 18);
  assert.deepEqual(vw.skipped_connections, []);
  assert.ok(vw.flattening.max_length_error_pct < 1);
  assert.equal(variants(vw).length, 1);
  assert.ok(vw.wires.every((w) => w.path.length >= 3));
});

test('harness: validation finds a broken path', () => {
  const bad = structuredClone(h);
  bad.wires[0].path = ['X1', 'X2'];
  assert.match(validateHarness(bad).join(), /without a segment/);
});

test('harness: variants are cumulative and filter wires', () => {
  const v = variants(h);
  assert.deepEqual(v.map((x) => wiresForVariant(h, x).length), [9, 10, 11, 12]);
  assert.equal(v[0].label, 'Basis');
});

test('harness: pegs only for used branches', () => {
  const basis = wiresForVariant(h, variants(h)[0]);
  const ids = pegsFor(h, basis).map((p) => p.id);
  assert.ok(ids.includes('P1') && ids.includes('N2'));
  assert.ok(!ids.includes('P7')); // ambient LED branch is not in Basis
});

test('harness: bundle slots spread wires sideways', () => {
  const w = h.wires.filter((x) => x.path[0] === 'X1');
  const slots = bundleSlots(w);
  const a = wirePolyline(w[0], pos, slots), c = wirePolyline(w[2], pos, slots);
  assert.equal(a.length, 3);
  assert.ok(Math.abs(a[1].y - c[1].y) > 10);
  assert.equal(a[1].x, pos.P1.x);
});

const at = (id, dx = 0) => ({ x: pos[id].x + dx, y: pos[id].y });

test('router: correct route snaps each node and finishes', () => {
  const r = new RoutingAttempt(['X2', 'P2', 'N1', 'P3', 'X3'], pos);
  assert.deepEqual(r.update(at('X2'), true), [{ type: 'grab', at: 'X2' }]);
  const types = ['P2', 'N1', 'P3', 'X3'].flatMap((id) => [...r.update({ x: 0, y: 0 }, true), ...r.update(at(id, 5), true)].map((e) => e.type));
  assert.deepEqual(types, ['snap', 'snap', 'snap', 'snap', 'done']);
  assert.equal(r.errors, 0);
  assert.ok(r.done);
});

test('router: grabs at the drawn wire end (bundle offset), not at the node centre', () => {
  const r = new RoutingAttempt(['X1', 'P1', 'X2'], pos);
  const drawn = { x: pos.X1.x, y: pos.X1.y + 38 }; // outer wire of a bundle
  assert.deepEqual(r.update({ x: drawn.x, y: drawn.y + 5 }, true, 30, drawn), [{ type: 'grab', at: 'X1' }]);
  const q = new RoutingAttempt(['X1', 'P1', 'X2'], pos);
  assert.deepEqual(q.update({ x: drawn.x, y: drawn.y + 5 }, true, 30), []); // old behaviour: missed
});

test('router: grab only near the wire end', () => {
  const r = new RoutingAttempt(['X1', 'P1', 'X2'], pos);
  assert.deepEqual(r.update(at('P1'), true), []);
  assert.equal(r.holding, false);
});

test('router: wrong branch counts once per entry, skipping counts too', () => {
  const r = new RoutingAttempt(['X2', 'P2', 'N1', 'P4', 'N2'], pos, nb);
  r.update(at('X2'), true);
  r.update(at('P2'), true);
  r.update(at('N1'), true);
  const e = r.update(at('P3'), true); // wrong branch at N1
  assert.equal(e[0].type, 'wrong');
  r.update(at('P3', 3), true); // still inside: no second error
  assert.equal(r.errors, 1);
  r.update(at('N2'), true); // skipped P4
  assert.equal(r.errors, 2);
  assert.equal(r.next, 'P4');
});

test('router: a correct move past a short side branch is not an error', () => {
  const hub = { A: { x: 0, y: 0 }, B: { x: 100, y: 0 }, C: { x: 25, y: 15 } };
  const r = new RoutingAttempt(['A', 'B'], hub, { A: ['B', 'C'], B: ['A'], C: ['A'] });
  r.update(hub.A, true);
  for (let x = 5; x <= 100; x += 5) r.update({ x, y: 0 }, true); // passes 15 mm from C
  assert.equal(r.errors, 0);
  assert.ok(r.done);
  const q = new RoutingAttempt(['A', 'B'], hub, { A: ['B', 'C'], B: ['A'], C: ['A'] });
  q.update(hub.A, true);
  q.update({ x: 25, y: 22 }, true); // clearly off track, at the side branch
  assert.equal(q.errors, 1);
});

test('router: unrelated nodes are ignored, the next node wins when both are in reach', () => {
  const r = new RoutingAttempt(['X1', 'P1', 'X2'], pos, nb);
  r.update(at('X1'), true);
  assert.deepEqual(r.update(at('X5'), true), []); // far away, not a branch of X1
  const crowded = { A: { x: 0, y: 0 }, B: { x: 20, y: 0 }, C: { x: 30, y: 0 } };
  const q = new RoutingAttempt(['A', 'C'], crowded, { A: ['B', 'C'], B: ['A'], C: ['A'] });
  q.update({ x: 0, y: 0 }, true);
  assert.deepEqual(q.update({ x: 22, y: 0 }, true), [{ type: 'snap', at: 'C' }, { type: 'done' }]);
  assert.equal(q.errors, 0);
});

test('router: release keeps progress, regrab at last node', () => {
  const r = new RoutingAttempt(['X1', 'P1', 'X2'], pos);
  r.update(at('X1'), true);
  r.update(at('P1'), true);
  assert.deepEqual(r.update(null, false), [{ type: 'release', at: 'P1' }]);
  assert.deepEqual(r.update(at('X1'), true), []);
  assert.deepEqual(r.update(at('P1'), true), [{ type: 'grab', at: 'P1' }]);
});

test('session: full flow to summary', () => {
  const s = new Session(h);
  const v = variants(h)[0];
  s.start(v, 'test', 0);
  assert.equal(s.state, 'prep');
  for (const p of s.pegs) s.setPeg(p.id, 1000);
  assert.equal(s.state, 'route');
  assert.equal(s.wire.id, 'W01');
  for (let i = 0; i < 9; i++) s.wireDone(i === 4 ? 2 : 0, 2000 + i * 1000);
  assert.equal(s.state, 'qa');
  QA_ITEMS.forEach((_, i) => s.checkQa(i, 20000));
  const sum = s.summary();
  assert.equal(s.state, 'summary');
  assert.equal(sum.wires.length, 9);
  assert.equal(sum.errors, 2);
  assert.equal(sum.total_s, 20);
  assert.equal(sum.wires[0].time_s, 1);
});

test('session: back undoes the previous wire', () => {
  const s = new Session(h);
  s.start(variants(h)[0], 'guided', 0);
  s.setAllPegs(0);
  s.wireDone(0, 1000);
  s.back(1500);
  assert.equal(s.index, 0);
  assert.equal(s.metrics[0].end, null);
  assert.equal(s.metrics[0].start, 1500);
});

test('session: cavity errors per wire, in the summary, and reset by back', () => {
  const s = new Session(vw);
  s.start(variants(vw)[0], 'guided', 0);
  s.setAllPegs(0);
  s.wireDone(1, 1000, 2);
  assert.equal(s.metrics[0].cavity_errors, 2);
  s.back(1500);
  assert.equal(s.metrics[0].cavity_errors, 0);
  s.wireDone(0, 2000, 1);
  while (s.state === 'route') s.wireDone(0, 3000);
  QA_ITEMS.forEach((_, i) => s.checkQa(i, 4000));
  const sum = s.summary();
  assert.equal(sum.cavity_errors, 1);
  assert.equal(sum.wires[0].cavity_errors, 1);
  assert.equal(sum.wires[0].cavity, s.wires[0].to);
});
