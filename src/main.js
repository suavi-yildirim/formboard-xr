// Formboard VR: wires the pure core (session, router) to the three.js scene and the pointers.
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { validateHarness, variants, wiresForVariant, nodePositions, bundleSlots, wirePolyline, nodeById, COLOURS } from './core/harness.js';
import { distance } from './core/grid.js';
import { RoutingAttempt, GRAB_MM, neighbourMap } from './core/router.js';

const TIP_GRAB_MM = 30; // fingertips must be this close to the wire end (or a ghost peg) to take it
import { Session, QA_ITEMS } from './core/session.js';
import { panelPress } from './core/press.js';
import { buildWorkshop } from './scene/workshop.js';
import { Board } from './scene/board.js';
import { WireLayer } from './scene/wires.js';
import { Panel } from './scene/panel.js';
import { Sfx } from './scene/audio.js';
import { VehicleView } from './scene/vehicle.js';
import { Pointers } from './input/pointers.js';
import { t, term, colourName, getLang, setLang, onLangChange } from './i18n.js';
import { Locomotion } from './input/locomotion.js';
import { heldWire } from './core/heldwire.js';
import { WIRE_Z } from './scene/wires.js';

const dataUrl = (f) => new URL(`./data/${f}`, import.meta.url);
const getJson = async (f) => (await fetch(dataUrl(f))).json();
const catalogue = await getJson('harnesses.json');

// --- renderer, scene, camera ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.setFoveation?.(0.5);
document.body.appendChild(renderer.domElement);
// Without immersive VR support (desktop browsers, Safari) show a plain note instead of the
// "WEBXR NOT AVAILABLE" / "VR NOT SUPPORTED" button.
const vrSupported = await navigator.xr?.isSessionSupported?.('immersive-vr').catch(() => false);
if (vrSupported) document.body.appendChild(VRButton.createButton(renderer));
else document.getElementById('vr-note').hidden = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.enableDamping = true;
controls.keyPanSpeed = 40;
controls.listenToKeyEvents(window); // arrow keys pan

// Desktop views: frame the panel and the board together, or the vehicle harness.
const VIEWS = {
  board: { left: -1.35, right: 0.62, bottom: 0.55, top: 1.6, z: -0.45, y: 0.45 },
  vehicle: { left: -2.4, right: 2.4, bottom: 0, top: 2.2, z: 0, y: 0, centre: new THREE.Vector3(2.5, 0.75, -0.9), from: new THREE.Vector3(-1, 0.45, 0.15) },
};
let view = 'board';
function fitCamera() {
  const v = VIEWS[view];
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const d = Math.max((v.right - v.left) / 2 / Math.tan(hfov / 2), (v.top - v.bottom) / 2 / Math.tan(vfov / 2)) * 1.05;
  if (view === 'board') {
    const cx = (v.left + v.right) / 2, cy = (v.bottom + v.top) / 2;
    camera.position.set(cx, cy + v.y, v.z + d);
    controls.target.set(cx, cy, v.z);
  } else {
    camera.position.copy(v.centre).addScaledVector(v.from.clone().normalize(), d);
    controls.target.copy(v.centre);
  }
  controls.update();
}
fitCamera();

const backButton = document.getElementById('back-to-board');
function setView(v) {
  view = v;
  backButton.hidden = v === 'board';
  fitCamera();
}
backButton.addEventListener('click', () => setView('board'));

const { metal, key } = buildWorkshop(scene);
// Soft studio reflections for metal, plastic and insulation (computed once, no download).
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const panel = new Panel();
panel.mesh.position.set(-0.82, 1.28, -0.3);
panel.mesh.rotation.y = 0.6;
scene.add(panel.mesh);

const sfx = new Sfx();
const pointers = new Pointers(renderer, scene, camera, renderer.domElement);
const loco = new Locomotion(renderer, scene);

// Jump spots (floor position and the point to face). The car spot is beside the engine end.
const SPOTS = {
  board: { pos: { x: 0, z: 0 }, look: { x: 0, z: -0.48 } },
  car: { pos: { x: 1.2, z: 0.55 }, look: { x: 2.5, z: 0.1 } },
};

// Small panel at the car with the way back to the workstation.
const carPanel = new Panel(0.4);
{
  const { pos, look } = SPOTS.car;
  const d = new THREE.Vector3(look.x - pos.x, 0, look.z - pos.z).normalize();
  const left = new THREE.Vector3(d.z, 0, -d.x);
  carPanel.mesh.position.set(pos.x + d.x * 0.55 + left.x * 0.45, 1.15, pos.z + d.z * 0.55 + left.z * 0.45);
  carPanel.mesh.lookAt(pos.x, 1.5, pos.z);
  scene.add(carPanel.mesh);
  carPanel.draw((g) => {
    g.text(t('carKicker'), 56, 80, { size: 30, weight: 700, colour: '#5ce1ff' });
    g.text(t('carTitle'), 56, 150, { size: 52, weight: 700, max: 912 });
    g.para(t('carText'), 56, 230, 912, { size: 34, colour: '#c5ceda' });
    g.button('goto:board', t('backBoard'), 56, 560, 912, 110, { primary: true, size: 40 });
  });
}
const panels = [panel, carPanel];

function goTo(spot) {
  if (loco.active) loco.jump(SPOTS[spot]);
  else setView(spot === 'car' ? 'vehicle' : 'board');
}

// The VW vehicle harness stands to the user's right, 1:1, with the engine end (rear of the Beetle,
// where the ignition harness sits) towards the user.
let vehicle = null;
getJson('vw_vehicle.json').then((data) => {
  vehicle = new VehicleView(data);
  vehicle.group.position.set(2.5, vehicle.liftM, -0.9);
  vehicle.group.rotation.y = -Math.PI / 2;
  scene.add(vehicle.group);
  updateVehicleSign();
  refresh();
});

function updateVehicleSign() {
  if (!vehicle) return;
  const d = vehicle.data;
  vehicle.setSign([
    t('sign1'),
    t('sign2', { n: d.full.length, id: d.full_id, c: d.full_connectors }),
    t('sign3', { id: d.highlight_id }),
    t('sign4'),
  ], new THREE.Vector3(0, 1.4, 0));
}

// --- harness-dependent state ---
const H = { file: null, harness: null, pos: {}, nb: {}, vlist: [], problems: [], session: null, board: null, wires: null };
const ui = { harnessIdx: 0, variant: 0, mode: 'guided', status: '', statusKind: '', ghostUntil: 0, lastSecond: -1, loading: false };
let attempt = null;
let owner = null; // pointer currently holding the wire
let polylines = {};
const now = () => performance.now();

async function loadHarness(i) {
  ui.loading = true;
  refresh();
  const h = await getJson(catalogue[i].file);
  H.board?.dispose();
  H.file = catalogue[i].file;
  H.harness = h;
  H.problems = validateHarness(h);
  H.pos = nodePositions(h);
  H.nb = neighbourMap(h.segments);
  H.vlist = variants(h);
  H.session = new Session(h);
  H.board = new Board(h, metal);
  // Tilted like a desk easel, resting on the bench, within arm's reach of the standing user.
  const tilt = 0.7, heightM = H.board.size.h / 1000 + 0.09;
  H.board.group.position.set(0, 0.765 + (heightM / 2) * Math.cos(tilt), -0.48);
  H.board.group.rotation.x = -tilt;
  key.target.position.copy(H.board.group.position);
  scene.add(H.board.group);
  H.wires = new WireLayer(H.board);
  ui.harnessIdx = i;
  ui.variant = 0;
  ui.loading = false;
  attempt = null;
  owner = null;
  refresh();
}

const connLabel = (w, end) => {
  const n = nodeById(H.harness, end === 'from' ? w.from_node : w.to_node);
  return `${w[end]}  ${n?.label ?? ''}`;
};

function startRun() {
  const { session, board, wires } = H;
  session.start(H.vlist[ui.variant], ui.mode, now());
  const slots = bundleSlots(session.wires);
  polylines = Object.fromEntries(session.wires.map((w) => [w.id, wirePolyline(w, H.pos, slots)]));
  wires.clearDone();
  wires.clearLive();
  wires.clearGhost();
  wires.setHandle(null);
  for (const id of Object.keys(board.pegs)) board.setPeg(id, 'hidden');
  for (const p of session.pegs) board.setPeg(p.id, 'ghost');
  board.setHalos([]);
  attempt = null;
  ui.status = '';
  setView('board');
  refresh();
}

function toMenu() {
  H.session.restart();
  attempt = null;
  owner = null;
  H.wires.clearLive();
  H.wires.clearGhost();
  H.wires.setHandle(null);
  H.wires.dimDone(false);
  H.board.setHalos([]);
  refresh();
}

function enterWire() {
  const w = H.session.wire;
  attempt = new RoutingAttempt(w.path, H.pos, H.nb);
  owner = null;
  H.wires.dimDone(true);
  H.wires.clearLive();
  H.wires.setGhost(w, polylines[w.id]);
  ui.status = '';
  updateGuides();
  updateLive(null);
  refresh();
}

function enterQa() {
  attempt = null;
  owner = null;
  H.wires.dimDone(false);
  H.wires.clearGhost();
  H.wires.clearLive();
  H.wires.setHandle(null);
  const ends = new Set(H.session.wires.flatMap((w) => [w.path[0], w.path.at(-1)]));
  H.board.setHalos([...ends], 0x3ddc84);
  refresh();
}

function updateGuides() {
  if (H.session.state !== 'route' || !attempt) return;
  const w = H.session.wire;
  const guided = H.session.mode === 'guided' || now() < ui.ghostUntil;
  const target = w.path.at(-1);
  const ids = guided && attempt.next ? [...new Set([attempt.next, target])] : [target];
  const c = COLOURS[w.colour];
  H.board.setHalos(ids, c === COLOURS.WH || c === COLOURS.BK ? 0x5ce1ff : c);
  H.wires.setGhostVisible(guided);
}

// Where the wire end is drawn (bundle-offset point), so it is grabbed exactly where it is seen.
function grabPoint() {
  return polylines[H.session.wire.id][attempt.reached - 1];
}

// --- the held wire grows as it is routed: it reaches from the last peg to the fingers under
// light tension (a slight sag) and no further; the unrouted rest is not shown. It cannot be
// pulled further than the wire really is long (then it is taut and its end stops short).
// The shape is computed fresh every frame (core/heldwire.js), so it cannot fold or jitter.
const SLACK = 1.02; // span length relative to the straight distance: light tension
const TAIL_M = 0; // no hanging remainder beyond the hand
let held = null; // { hand, taut, result } while a wire is held
const HANDLING_MM = 60; // extra length for handling (terminals, crimp ends)
const polyLen = (pts) => pts.slice(1).reduce((sum, q, i) => sum + distance(pts[i], q), 0);

// Wire length on the board: the KBL length (VW: equal to the flattened path), kept plausible for
// the fictitious harness (between the path length and 1.6 times it).
function wireLengthMm(w) {
  const path = polyLen(polylines[w.id]);
  return Math.min(Math.max(w.length_mm || path, path), path * 1.6) + HANDLING_MM;
}

function handLocal(p) {
  if (p === pointers.mouse) return p.work.mm ? H.board.local(p.work.mm, 0.04) : null;
  return p.work.freeEnd;
}

function grabRope(p) {
  const start = H.board.local(grabPoint(), WIRE_Z);
  held = { hand: handLocal(p) ?? start, taut: false, result: null };
}

// Shape the held wire; returns where the wire end is on the board (mm), or null when lifted away.
function stepRope(p) {
  const w = H.session.wire;
  held.hand = handLocal(p) ?? held.hand;
  const q = H.board.group.getWorldQuaternion(new THREE.Quaternion()).invert();
  held.result = heldWire({
    start: H.board.local(grabPoint(), WIRE_Z),
    hand: held.hand,
    remaining: Math.max(0.02, (wireLengthMm(w) - polyLen(polylines[w.id].slice(0, attempt.reached))) / 1000),
    gravity: new THREE.Vector3(0, -9.81, 0).applyQuaternion(q),
    slack: SLACK, tail: TAIL_M, floorZ: 0.003, bounds: H.board.surfaceSize,
  });
  if (held.result.taut && !held.taut) p.pulse(0.25, 25); // feel the wire go tight
  held.taut = held.result.taut;
  const end = held.result.end;
  return end.z > -0.08 && end.z < 0.12 ? H.board.localToMm(end) : null;
}

// Live wire = routed part (bundle-offset points) plus, while held, the free part and its tail.
function updateLive() {
  const w = H.session.wire;
  const routed = polylines[w.id].slice(0, attempt.reached);
  if (attempt.holding && held?.result) {
    H.wires.setLiveRope(w, routed, [...held.result.points, ...held.result.tail]);
    const e = held.result.end;
    H.wires.setHandle(w, null, true, new THREE.Vector3(e.x, e.y, e.z));
    return;
  }
  if (routed.length >= 2) H.wires.setLive(w, routed);
  else H.wires.clearLive();
  H.wires.setHandle(w, routed.at(-1), false);
}

function handleEvents(events, p) {
  for (const e of events) {
    if (e.type === 'grab') { sfx.grab(); p.pulse(0.3, 20); }
    if (e.type === 'snap') {
      sfx.snap(); p.pulse(0.6, 40);
      H.board.flash(e.at, 0x3ddc84);
      ui.status = `✓ ${e.at}`; ui.statusKind = 'ok';
      updateGuides();
    }
    if (e.type === 'wrong') {
      sfx.wrong(); p.pulse(1, 140);
      H.board.flash(e.at, 0xff3b30);
      ui.status = H.session.mode === 'guided' ? t('statusWrongGuided', { p: e.at, n: e.expected }) : t('statusWrongTest', { p: e.at });
      ui.statusKind = 'err';
    }
    if (e.type === 'done') {
      sfx.done();
      const w = H.session.wire;
      H.wires.setDone(w, polylines[w.id]);
      H.session.wireDone(attempt.errors, now());
      if (H.session.state === 'qa') enterQa();
      else enterWire();
      return;
    }
    refresh();
  }
}

function back() {
  const s = H.session;
  if (s.state !== 'qa' && !(s.state === 'route' && s.index > 0)) return;
  s.back(now());
  H.wires.removeDone(s.wire.id);
  enterWire();
}

function showMe() {
  if (H.session.state !== 'route') return;
  H.session.hint();
  ui.ghostUntil = now() + 3000;
  H.wires.startTour();
  updateGuides();
  refresh();
}

function downloadLog() {
  const log = { ...H.session.summary(), harness_file: H.file, date: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `formboard-log-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function onButton(id) {
  sfx.click();
  const s = H.session;
  if (id.startsWith('lang:')) { setLang(id.split(':')[1]); return; }
  if (id.startsWith('harness:')) { const i = Number(id.split(':')[1]); if (i !== ui.harnessIdx) loadHarness(i); return; }
  if (id.startsWith('variant:')) ui.variant = Number(id.split(':')[1]);
  else if (id.startsWith('mode:')) ui.mode = id.split(':')[1];
  else if (id === 'start') startRun();
  else if (id === 'menu') toMenu();
  else if (id === 'vehicle') goTo('car');
  else if (id === 'goto:board') goTo('board');
  else if (id === 'allpegs') { for (const p of s.pegs) H.board.setPeg(p.id, 'set'); s.setAllPegs(now()); enterWire(); return; }
  else if (id === 'showme') showMe();
  else if (id === 'back') back();
  else if (id.startsWith('qa:')) {
    s.checkQa(Number(id.split(':')[1]), now());
    if (s.state === 'summary') { sfx.finish(); H.board.setHalos([]); console.log('formboard log', s.summary()); }
  } else if (id === 'download') downloadLog();
  else if (id === 'again') startRun();
  refresh();
}

function onBoardPress(p) {
  const s = H.session;
  if (s.state !== 'prep' || !p.work.mm) return;
  let best = null, bestD = p.work.grab;
  for (const peg of s.pegs) {
    if (s.pegsSet.has(peg.id)) continue;
    const d = distance(p.work.mm, H.pos[peg.id]);
    if (d < bestD) { best = peg; bestD = d; }
  }
  if (!best) return;
  H.board.setPeg(best.id, 'set');
  p.pinchUsed = true; // one peg per pinch
  sfx.snap(); p.pulse(0.5, 30);
  s.setPeg(best.id, now());
  if (s.state === 'route') enterWire();
  else refresh();
}

// --- panel views ---
const L = 56, R = 968;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Kicker line and title; the menu also shows the EN | DE language switch at the top right.
function header(g, kicker, title, langSwitch = false) {
  g.text(kicker, L, 72, { size: 24, weight: 700, colour: '#5ce1ff', max: langSwitch ? 700 : R - L });
  if (langSwitch) {
    g.button('lang:en', 'EN', R - 176, 36, 84, 50, { selected: getLang() === 'en', size: 24 });
    g.button('lang:de', 'DE', R - 84, 36, 84, 50, { selected: getLang() === 'de', size: 24 });
  }
  if (title) g.text(title, L, 124, { size: 40, weight: 700, max: R - L });
}

const views = {
  menu(g) {
    const h = H.harness;
    header(g, t('menuKicker'), term(h.description), true);
    g.text(`${h.id} · ${t('wiresN', { n: h.wires.length })} · ${term(h.source)}`, L, 162, { size: 22, colour: '#9aa7b8', max: R - L });
    if (H.problems.length) { g.para(t('invalid', { p: H.problems.join('; ') }), L, 230, R - L, { colour: '#ff6b6b' }); return; }
    g.text(t('harness'), L, 212, { size: 24, weight: 600, colour: '#9aa7b8' });
    catalogue.forEach((c, i) => g.button(`harness:${i}`, `${term(c.label)} · ${term(c.note)}`, L + i * 464, 226, 448, 62, { selected: ui.harnessIdx === i, size: 25 }));
    g.text(t('variant'), L, 326, { size: 24, weight: 600, colour: '#9aa7b8' });
    H.vlist.forEach((v, i) => {
      const n = wiresForVariant(h, v).length;
      g.button(`variant:${i}`, `${term(v.label)} · ${n}`, L + (i % 2) * 464, 340 + Math.floor(i / 2) * 70, 448, 58, { selected: ui.variant === i, size: 24 });
    });
    if (h.flattening) {
      g.para(t('flattened', { n: h.flattening.segments, d: h.flattening.max_length_error_pct }), L, 440, R - L, { size: 20, colour: '#c5ceda' });
    }
    g.text(t('mode'), L, 514, { size: 24, weight: 600, colour: '#9aa7b8' });
    g.button('mode:guided', t('guided'), L, 526, 448, 60, { selected: ui.mode === 'guided' });
    g.button('mode:test', t('test'), L + 464, 526, 448, 60, { selected: ui.mode === 'test' });
    g.button('start', ui.loading ? t('loading') : t('start'), L, 610, 600, 80, { primary: true, size: 32, disabled: ui.loading });
    g.button('vehicle', t('goCar'), L + 616, 610, 296, 80, { disabled: !vehicle, size: 26 });
  },

  prep(g) {
    const s = H.session;
    header(g, t('prepKicker'), t('prepTitle'));
    const y = g.para(t('prepText'), L, 190, R - L);
    const n = s.pegsSet.size, total = s.pegs.length;
    g.text(t('pegsN', { n, total }), L, y + 50, { size: 34, weight: 700 });
    g.bar(L, y + 74, R - L, 18, n / total);
    g.button('allpegs', t('allPegs'), L, 620, 448, 76);
    g.button('menu', t('menu'), L + 464, 620, 448, 76);
  },

  route(g) {
    const s = H.session;
    const w = s.wire, i = s.index, n = s.wires.length;
    header(g, t('routeKicker', { i: i + 1, n, mode: t(s.mode).toLocaleUpperCase(getLang()) }), '');
    g.swatch(L + 22, 112, COLOURS[w.colour] ?? 0xcccccc, 22);
    const colour = `${colourName(w.colour)}${w.stripe ? `/${colourName(w.stripe)}` : ''}`;
    g.text(`${w.id}  ${colour} · ${w.cross_section_mm2} mm²`, L + 60, 124, { size: 40, weight: 700, max: R - L - 60 });
    g.text(t('signal', { s: w.signal, l: w.length_mm }), L, 170, { size: 26, colour: '#9aa7b8', max: R - L });
    g.text(t('from'), L, 222, { size: 24, colour: '#9aa7b8' });
    g.text(connLabel(w, 'from'), L + 90, 222, { size: 28, weight: 600, max: R - L - 90 });
    g.text(t('to'), L, 264, { size: 24, colour: '#9aa7b8' });
    g.text(connLabel(w, 'to'), L + 90, 264, { size: 28, weight: 600, max: R - L - 90 });
    const instr = attempt?.holding
      ? (s.mode === 'guided' ? t('pullTo', { p: attempt.next }) : t('pullAlong'))
      : attempt?.reached > 1
        ? t('grabContinue', { p: attempt.end })
        : t('grabStart', { a: w.path[0], b: w.path.at(-1) });
    g.para(instr, L, 322, R - L, { size: 28 });
    if (ui.status) g.text(ui.status, L, 420, { size: 30, weight: 700, colour: ui.statusKind === 'err' ? '#ff6b6b' : '#3ddc84' });
    const m = s.metrics[i];
    g.text(t('stats', { e: attempt?.errors ?? 0, h: m.hints, t: fmt((now() - m.start) / 1000) }), L, 478, { size: 28, colour: '#c5ceda' });
    g.text(t('peg', { a: attempt ? attempt.reached : 0, b: w.path.length }), R, 478, { size: 28, colour: '#c5ceda', align: 'right' });
    g.bar(L, 510, R - L, 14, attempt ? (attempt.reached - 1) / (w.path.length - 1) : 0, `#${(COLOURS[w.colour] ?? 0x5ce1ff).toString(16).padStart(6, '0')}`);
    g.bar(L, 540, R - L, 8, i / n);
    g.button('showme', t('showMe'), L, 620, 290, 76);
    g.button('back', t('undo'), L + 311, 620, 290, 76, { disabled: i === 0 });
    g.button('menu', t('menu'), L + 622, 620, 290, 76);
  },

  qa(g) {
    const s = H.session;
    header(g, t('qaKicker'), t('qaTitle'));
    g.text(t('qaText'), L, 172, { size: 26, colour: '#c5ceda', max: R - L });
    QA_ITEMS.forEach((_, i) => g.button(`qa:${i}`, `${s.qa.has(i) ? '☑' : '☐'}  ${t('qa' + i)}`, L, 210 + i * 92, R - L, 76, { selected: s.qa.has(i) }));
    g.button('back', t('backLast'), L, 620, 448, 76);
    g.button('menu', t('menu'), L + 464, 620, 448, 76);
  },

  summary(g) {
    const s = H.session.summary();
    header(g, t('doneKicker'), `${term(s.variant)} · ${t(s.mode)}`);
    g.text(t('total', { t: fmt(s.total_s) }), L, 196, { size: 36, weight: 700 });
    g.text(t('errorsN', { n: s.errors }), L + 330, 196, { size: 36, weight: 700, colour: s.errors ? '#ff6b6b' : '#3ddc84' });
    g.text(t('hintsN', { n: s.hints }), L + 610, 196, { size: 36, weight: 700, colour: '#c5ceda' });
    const cols = s.wires.length > 12 ? 3 : 2, per = Math.ceil(s.wires.length / cols), colW = (R - L) / cols;
    const rowH = Math.min(54, 330 / per);
    s.wires.forEach((w, i) => {
      const x = L + Math.floor(i / per) * colW, y = 256 + (i % per) * rowH;
      const wire = H.session.wires.find((x) => x.id === w.wire);
      g.swatch(x + 14, y - 9, COLOURS[wire.colour] ?? 0xcccccc, 11);
      g.text(`${w.wire}  ${w.time_s.toFixed(1)} s  ${t('errShort', { n: w.errors })}`, x + 36, y, { size: Math.min(26, rowH * 0.62), colour: w.errors ? '#ffb3b3' : '#e9eef5', max: colW - 44 });
    });
    g.button('download', t('download'), L, 620, 290, 76);
    g.button('vehicle', t('goCar'), L + 311, 620, 290, 76, { disabled: !vehicle });
    g.button('again', t('again'), L + 622, 620, 290, 76, { primary: true });
  },
};

function refresh() {
  if (!H.session) {
    panel.draw((g) => header(g, 'FORMBOARD VR', t('loadingHarness')));
    return;
  }
  panel.draw(views[H.session.state]);
}

// --- frame loop ---
const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  if (!renderer.xr.isPresenting) controls.update();

  const hover = new Map(panels.map((x) => [x, null]));
  let marker = null;
  for (const p of pointers.update()) {
    const mouse = p === pointers.mouse;
    // Board work. VR: direct touch at the fingertips (pinch point), no ray. Desktop: mouse ray.
    let nearBoard = false;
    if (mouse) {
      p.work = { mm: null, pressed: false, justPressed: false, canGrab: false, grab: GRAB_MM, freeEnd: null };
    } else {
      const probe = p.tip && H.board ? H.board.probe(p.tip) : null;
      const inside = probe && probe.mm.x > -60 && probe.mm.y > -60 && probe.mm.x < H.board.size.w + 60 && probe.mm.y < H.board.size.h + 60;
      // Fingers easily sink into a virtual board (no resistance): accept up to 8 cm behind the surface.
      nearBoard = !!(inside && probe.z > -0.12 && probe.z < 0.2);
      const touching = inside && probe.z > -0.08 && probe.z < 0.07; // to pick up a wire end or set a peg
      const guiding = inside && probe.z > -0.08 && probe.z < 0.12; // while pulling, the hand may lift a bit
      pointers.setTipVisible(p, nearBoard);
      p.work = {
        mm: guiding ? probe.mm : null, pressed: p.pinching,
        // act only where the pinch closes (plus a short grace period), not by sweeping into a wire
        justPressed: touching && pointers.pinchFresh(p),
        canGrab: touching && pointers.pinchFresh(p),
        grab: TIP_GRAB_MM, freeEnd: probe ? probe.local : null,
      };
    }

    // Rays: panel buttons and teleport. In VR not while the hand works at the board.
    let hp = null, hitPanel = null;
    if (!nearBoard) {
      for (const x of panels) {
        const h = p.raycaster.intersectObject(x.mesh)[0];
        if (h && (!hp || h.distance < hp.distance)) { hp = h; hitPanel = x; }
      }
    }
    const hb = mouse && H.board ? p.raycaster.intersectObject(H.board.surface)[0] : null;
    const panelFirst = !!hp && (!hb || hp.distance < hb.distance);
    p.panelId = panelFirst ? hitPanel.hit(hp.uv) : null;
    p.pressOnPanel = panelPress(p.pressOnPanel, { justPressed: p.justPressed, pressed: p.pressed || p.pinching, nearBoard, panelFirst });
    if (mouse) {
      const mm = !panelFirst && hb ? H.board.toMm(hb.point) : null;
      const pressed = p.pressed && !p.pressOnPanel;
      p.work = { mm, pressed, justPressed: p.justPressed && !panelFirst, canGrab: pressed, grab: GRAB_MM, freeEnd: null };
    }
    // Teleport: hold the controller's grip button, aim at the floor, release. Never by pinching.
    const floor = !mouse && p.squeezing && loco.active ? loco.floorHit(p.raycaster.ray) : null;
    if (p.squeezing) { if (floor) p.floorTarget = floor; marker = p.floorTarget ?? null; }
    else if (p.floorTarget) { loco.teleport(p.floorTarget); sfx.grab(); p.floorTarget = null; }
    p.setRayLength(hp ? hp.distance : floor ? floor.distanceTo(p.raycaster.ray.origin) : undefined);
    if (!mouse) pointers.setRayVisible(p, !!(hp || p.squeezing));
    if (p.panelId) hover.set(hitPanel, p.panelId);
    if (p.justPressed && !nearBoard) {
      sfx.unlock();
      if (p.panelId) onButton(p.panelId);
    }
    if (p.work.justPressed && H.session) { sfx.unlock(); onBoardPress(p); }
  }
  for (const [x, id] of hover) x.setHover(id);
  loco.showMarker(marker);
  loco.update(dt, pointers.list);

  if (H.session?.state === 'route' && attempt) {
    if (!owner) {
      for (const p of pointers.list) {
        if (!p.enabled || !p.work?.canGrab || p.pressOnPanel) continue;
        handleEvents(attempt.update(p.work.mm, true, p.work.grab, grabPoint()), p);
        if (attempt?.holding) { owner = p; p.pinchUsed = true; grabRope(p); break; }
      }
    } else {
      const p = owner;
      // A short tracking dropout keeps the wire in hand; a longer one drops it at the last peg.
      if (p.enabled) p.lostAt = null; else p.lostAt ??= now();
      const holding = p.enabled ? p.work.pressed : now() - p.lostAt < 300;
      // the router follows the wire's real end, which stops short of the hand when the wire is taut
      const endMm = holding ? stepRope(p) : null;
      const events = attempt.update(endMm, holding, p.work.grab);
      if (!attempt.holding) owner = null;
      handleEvents(events, p);
    }
    if (H.session.state === 'route' && attempt) {
      updateLive();
      if (ui.ghostUntil && now() > ui.ghostUntil) { ui.ghostUntil = 0; updateGuides(); }
      const sec = Math.floor(now() / 1000);
      if (sec !== ui.lastSecond) { ui.lastSecond = sec; refresh(); }
    }
  }

  H.board?.update(dt, t);
  H.wires?.update(dt, t);
  vehicle?.update(t);
  renderer.render(scene, camera);
}

// Language switch (VR menu or help box): redraw everything that shows text.
function applyLang() {
  document.documentElement.lang = getLang();
  for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n);
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
  const toggle = document.getElementById('info-toggle');
  if (toggle) {
    toggle.dataset.show = t('showHelp');
    toggle.dataset.hide = t('hideHelp');
    toggle.title = toggle.ariaLabel = t(document.getElementById('info').classList.contains('collapsed') ? 'showHelp' : 'hideHelp');
  }
  document.querySelector('#info .lang')?.setAttribute('aria-label', t('language'));
  refresh();
  carPanel.redraw();
  updateVehicleSign();
  H.board?.relabel();
}
onLangChange(applyLang);
for (const b of document.querySelectorAll('[data-lang]')) b.addEventListener('click', () => setLang(b.dataset.lang));
applyLang();

renderer.xr.addEventListener('sessionstart', refresh);
renderer.xr.addEventListener('sessionend', () => { refresh(); fitCamera(); });
await loadHarness(0);
renderer.setAnimationLoop(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (!renderer.xr.isPresenting) fitCamera();
});

// Debug handle. step() renders one frame by hand, for scripted tests when the page gets no animation frames.
window.formboard = { H, panel, carPanel, camera, step: frame, load: loadHarness, setView };
