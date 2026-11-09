// The formboard: perforated surface with the 1:1 drawing, connectors, pegs, halos and flashes.
// Board group local space: metres, origin at the grid centre, x right, y up, z out of the surface.
import * as THREE from 'three';
import { boardSizeMm, colName } from '../core/grid.js';
import { nodePositions } from '../core/harness.js';
import { cavityLayout } from '../core/cavity.js';
import { t, term } from '../i18n.js';

const MARGIN_MM = 45;
const TEX_PX_PER_MM = 1.6;
const PEG_H = 0.05;

export class Board {
  constructor(harness, metal) {
    this.h = harness;
    this.size = boardSizeMm(harness.board);
    this.group = new THREE.Group();
    this.pos = nodePositions(harness);
    // Real harnesses have connectors only a few cm apart: smaller bodies, id-only labels.
    this.dense = (harness.min_edge_mm ?? 100) < 60;
    this.pegs = {};
    this.halos = {};
    this.flashes = [];
    this.seats = {}; // wire id -> mesh of its end seated in a cavity
    this.metal = metal;

    this.buildSurface();
    this.buildFrame();
    this.buildConnectors();
    this.buildPegs();
  }

  local(p, z = 0) {
    return new THREE.Vector3(p.x / 1000 - this.size.w / 2000, p.y / 1000 - this.size.h / 2000, z);
  }

  // Any world point -> board mm in the plane plus its height above the surface (metres).
  probe(world) {
    const l = this.group.worldToLocal(world.clone());
    return { mm: { x: (l.x + this.size.w / 2000) * 1000, y: (l.y + this.size.h / 2000) * 1000 }, z: l.z, local: l };
  }

  localToMm(l) {
    return { x: (l.x + this.size.w / 2000) * 1000, y: (l.y + this.size.h / 2000) * 1000 };
  }

  // Board surface in metres (grid plus margin), for resting wires on it.
  get surfaceSize() {
    return { w: (this.size.w + 2 * MARGIN_MM) / 1000, h: (this.size.h + 2 * MARGIN_MM) / 1000 };
  }

  // World point on the surface -> board mm, or null when off the grid area (with margin).
  toMm(world) {
    const l = this.group.worldToLocal(world.clone());
    const p = { x: (l.x + this.size.w / 2000) * 1000, y: (l.y + this.size.h / 2000) * 1000 };
    if (p.x < -MARGIN_MM || p.y < -MARGIN_MM || p.x > this.size.w + MARGIN_MM || p.y > this.size.h + MARGIN_MM) return null;
    return p;
  }

  // Plywood board with the 1:1 formboard drawing printed on paper and glued on, as in harness shops.
  buildSurface() {
    const { w, h } = this.size;
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry((w + 2 * MARGIN_MM) / 1000, (h + 2 * MARGIN_MM) / 1000), new THREE.MeshStandardMaterial({ map: this.surfaceTexture(), roughness: 0.95, envMapIntensity: 0.4 }));
    this.surface.receiveShadow = true;
    this.group.add(this.surface);
  }

  // Redraw the printed drawing (its title follows the language).
  relabel() {
    const old = this.surface.material.map;
    this.surface.material.map = this.surfaceTexture();
    old.dispose();
  }

  surfaceTexture() {
    const { w, h } = this.size;
    const W = w + 2 * MARGIN_MM, H = h + 2 * MARGIN_MM;
    const c = document.createElement('canvas');
    c.width = Math.round(W * TEX_PX_PER_MM);
    c.height = Math.round(H * TEX_PX_PER_MM);
    const g = c.getContext('2d');
    const s = TEX_PX_PER_MM;
    const X = (mm) => (mm + MARGIN_MM) * s;
    const Y = (mm) => (h - mm + MARGIN_MM) * s;

    woodGrain(g, c.width, c.height);
    // paper sheet with a soft shadow edge
    const inset = 8;
    g.fillStyle = 'rgba(60,40,20,0.25)';
    g.fillRect(X(-MARGIN_MM + inset) + 3, Y(h + MARGIN_MM - inset) + 3, (W - 2 * inset) * s, (H - 2 * inset) * s);
    g.fillStyle = '#e4ddcb';
    g.fillRect(X(-MARGIN_MM + inset), Y(h + MARGIN_MM - inset), (W - 2 * inset) * s, (H - 2 * inset) * s);

    // grid at cell borders
    g.strokeStyle = '#cfc6af';
    g.lineWidth = 1.2;
    const p = this.h.board.pitch_mm;
    for (let x = 0; x <= w; x += p) { g.beginPath(); g.moveTo(X(x), Y(0)); g.lineTo(X(x), Y(h)); g.stroke(); }
    for (let y = 0; y <= h; y += p) { g.beginPath(); g.moveTo(X(0), Y(y)); g.lineTo(X(w), Y(y)); g.stroke(); }
    g.fillStyle = '#5a6472';
    g.font = `600 ${14 * s}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let col = 0; col < this.h.board.cols; col++) {
      g.fillText(colName(col), X((col + 0.5) * p), Y(-MARGIN_MM / 2));
      g.fillText(colName(col), X((col + 0.5) * p), Y(h + MARGIN_MM / 2));
    }
    for (let row = 0; row < this.h.board.rows; row++) {
      g.fillText(String(row + 1), X(-MARGIN_MM / 2), Y((row + 0.5) * p));
      g.fillText(String(row + 1), X(w + MARGIN_MM / 2), Y((row + 0.5) * p));
    }
    // drawing: bundle outline (light band) with its centre line, as on a printed formboard drawing
    g.lineCap = 'round';
    for (const [lw, col] of [[12 * s, 'rgba(60,80,110,0.22)'], [2.2 * s, '#26303c']]) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      for (const [a, b] of this.h.segments) {
        g.beginPath(); g.moveTo(X(this.pos[a].x), Y(this.pos[a].y)); g.lineTo(X(this.pos[b].x), Y(this.pos[b].y)); g.stroke();
      }
    }
    // connector outlines with their ids, peg crosses and names
    g.strokeStyle = '#2f3a48';
    g.lineWidth = 1.2 * s;
    g.fillStyle = '#2f3a48';
    g.font = `600 ${10 * s}px system-ui, sans-serif`;
    for (const n of this.h.nodes) {
      const q = this.pos[n.id];
      if (n.kind === 'connector') {
        g.strokeRect(X(q.x) - 9 * s, Y(q.y) - 7 * s, 18 * s, 14 * s);
        continue;
      }
      g.beginPath(); g.moveTo(X(q.x) - 5 * s, Y(q.y)); g.lineTo(X(q.x) + 5 * s, Y(q.y)); g.moveTo(X(q.x), Y(q.y) - 5 * s); g.lineTo(X(q.x), Y(q.y) + 5 * s); g.stroke();
      if (n.kind === 'peg' && this.dense) continue;
      g.fillText(n.cell ? `${n.id} · ${n.cell}` : n.id, X(q.x), Y(q.y - 16));
    }
    g.textAlign = 'left';
    g.font = `bold ${12 * s}px system-ui, sans-serif`;
    g.fillText(`${this.h.id} · ${term(this.h.description)} · ${t('drawing')}`, X(4), Y(h - 12));
    if (this.h.source) {
      g.font = `${9 * s}px system-ui, sans-serif`;
      g.fillText(term(this.h.source), X(4), Y(8));
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  buildFrame() {
    const { w, h } = this.size;
    const W = (w + 2 * MARGIN_MM) / 1000, H = (h + 2 * MARGIN_MM) / 1000;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    woodGrain(c.getContext('2d'), 512, 128, '#8a6239');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const wood = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, H + 0.03, 0.025), wood);
    back.position.z = -0.0126;
    back.castShadow = back.receiveShadow = true;
    this.group.add(back);
    // Rear struts down to the bench, so the tilted board does not float. In mixed reality they are
    // hidden: they would reach through the real table top.
    this.struts = [];
    for (const x of [-W / 2 + 0.15, W / 2 - 0.15]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), this.metal);
      strut.position.set(x, -H / 2 + 0.12, -0.3);
      strut.rotation.x = 0.55;
      this.group.add(strut);
      this.struts.push(strut);
    }
  }

  // Connectors as their KBL parts look: housings with cavities and a latch, rubber spark-plug
  // boots, copper ring lugs, heat-shrunk splices. The wire side faces the bundle.
  buildConnectors() {
    this.connectors = {};
    for (const n of this.h.nodes.filter((x) => x.kind === 'connector')) {
      const { grp, cavities } = connectorModel(n, this.dense, this.metal);
      grp.position.copy(this.local(this.pos[n.id]));
      grp.rotation.z = this.segmentAngle(n.id) + Math.PI; // front away from the wires
      grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(grp);
      const label = makeLabel(this.dense ? n.id : `${n.id}  ${n.label}`, this.dense ? 0.07 : 0.16);
      label.position.copy(this.local(this.pos[n.id], 0.045));
      label.position.y += this.dense ? 0.022 : 0.035;
      this.group.add(label);
      this.connectors[n.id] = { grp, cavities };
    }
  }

  buildPegs() {
    const post = new THREE.CylinderGeometry(0.004, 0.005, PEG_H, 12).rotateX(Math.PI / 2).translate(0, 0, PEG_H / 2);
    const prong = new THREE.CylinderGeometry(0.0025, 0.0025, 0.03, 8).rotateX(Math.PI / 2);
    const cap = new THREE.SphereGeometry(0.008, 16, 8);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.45, depthWrite: false });
    const branchMat = new THREE.MeshStandardMaterial({ color: 0xf07b16, roughness: 0.4 });

    for (const n of this.h.nodes.filter((x) => x.kind !== 'connector')) {
      const set = new THREE.Group();
      set.add(new THREE.Mesh(post, this.metal));
      const washer = new THREE.Mesh(WASHER, this.metal);
      washer.position.z = 0.001;
      set.add(washer);
      const dir = this.segmentAngle(n.id);
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(prong, this.metal);
        m.position.set(Math.cos(dir + Math.PI / 2) * 0.008 * s, Math.sin(dir + Math.PI / 2) * 0.008 * s, PEG_H - 0.005);
        set.add(m);
      }
      if (n.kind === 'branch') {
        const c = new THREE.Mesh(cap, branchMat);
        c.position.z = PEG_H + 0.012;
        set.add(c);
      }
      set.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const ghost = set.clone();
      ghost.traverse((o) => { if (o.isMesh) o.material = this.ghostMat; });

      const grp = new THREE.Group();
      grp.position.copy(this.local(this.pos[n.id]));
      grp.add(set, ghost);
      set.visible = ghost.visible = false;
      this.group.add(grp);
      this.pegs[n.id] = { grp, set, ghost, drop: 0 };
    }
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [o.material].flat()) { m?.map?.dispose(); m?.dispose(); }
    });
    this.group.removeFromParent();
  }

  segmentAngle(id) {
    const seg = this.h.segments.find(([a, b]) => a === id || b === id);
    const other = seg[0] === id ? seg[1] : seg[0];
    return Math.atan2(this.pos[other].y - this.pos[id].y, this.pos[other].x - this.pos[id].x);
  }

  // A wire end seated in its cavity: the terminal shows in the hole, in the wire's colour.
  seat(wireId, nodeId, cavity, colour) {
    this.unseat(wireId);
    const c = this.connectors[nodeId];
    const at = c?.cavities?.[String(cavity)];
    if (!at) return;
    const m = new THREE.Mesh(SEAT, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45, emissive: colour, emissiveIntensity: 0.25 }));
    m.position.copy(at);
    c.grp.add(m);
    this.seats[wireId] = m;
  }

  unseat(wireId) {
    const m = this.seats[wireId];
    if (!m) return;
    m.removeFromParent();
    m.material.dispose();
    delete this.seats[wireId];
  }

  clearSeats() {
    for (const id of Object.keys(this.seats)) this.unseat(id);
  }

  setPeg(id, state) {
    const p = this.pegs[id];
    if (!p) return;
    p.ghost.visible = state === 'ghost';
    if (state === 'set' && !p.set.visible) p.drop = 1;
    p.set.visible = state === 'set';
  }

  // Pulsing rings on the given nodes; colour as hex.
  setHalos(ids, colour = 0x5ce1ff) {
    for (const [id, m] of Object.entries(this.halos)) m.visible = ids.includes(id);
    for (const id of ids) {
      if (!this.halos[id]) {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.027, 40), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        m.position.copy(this.local(this.pos[id], 0.003));
        this.group.add(m);
        this.halos[id] = m;
      }
      this.halos[id].material.color.setHex(colour);
      this.halos[id].visible = true;
    }
  }

  flash(id, colour) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.032, 32), new THREE.MeshBasicMaterial({ color: colour, transparent: true, depthWrite: false }));
    m.position.copy(this.local(this.pos[id], 0.004));
    this.group.add(m);
    this.flashes.push({ m, t: 0 });
  }

  update(dt, t) {
    const pulse = 1 + 0.25 * Math.sin(t * 6);
    for (const m of Object.values(this.halos)) {
      m.scale.setScalar(pulse);
      m.material.opacity = 0.55 + 0.35 * Math.sin(t * 6);
    }
    this.ghostMat.opacity = 0.3 + 0.2 * Math.sin(t * 4);
    for (const p of Object.values(this.pegs)) {
      if (p.drop > 0) {
        p.drop = Math.max(0, p.drop - dt * 5);
        p.set.position.z = p.drop * p.drop * 0.08;
      }
    }
    this.flashes = this.flashes.filter((f) => {
      f.t += dt;
      f.m.material.opacity = Math.max(0, 0.8 - f.t * 1.6);
      f.m.scale.setScalar(1 + f.t * 1.5);
      if (f.t > 0.5) { this.group.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); return false; }
      return true;
    });
  }
}

const WASHER = new THREE.CylinderGeometry(0.009, 0.009, 0.002, 20).rotateX(Math.PI / 2);
const SEAT = new THREE.BoxGeometry(0.0016, 0.0022, 0.0022);

function woodGrain(g, w, h, base = '#c49a6c') {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < h / 2; i++) {
    const y = Math.random() * h, a = 0.04 + Math.random() * 0.08;
    g.strokeStyle = Math.random() < 0.5 ? `rgba(90,55,25,${a})` : `rgba(255,230,190,${a})`;
    g.lineWidth = 0.5 + Math.random() * 2.5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += w / 8) g.lineTo(x, y + Math.sin(x / w * 6 + i) * 3);
    g.stroke();
  }
}

const HOUSING = { BK: 0x1d1f22, WH: 0xe8e8e2, GY: 0x8d9298, BN: 0x6b4428, BU: 0x2a5aa8, GN: 0x2f7d45, RD: 0xa52a2a, YE: 0xd9b52a, NT: 0xe2d6b8, VT: 0x6d3e91 };

// One connector, in its own frame: wires enter at the origin from -x, the front faces +x.
// Returns the group and, for housings, where each cavity opens on the front ({ number: Vector3 }).
function connectorModel(n, dense, metal) {
  const grp = new THREE.Group();
  const out = { grp, cavities: null };
  const k = dense ? 1 : 1.5;
  const plastic = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 });
  if (n.shape === 'ring') {
    const lug = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0018, 10, 24), new THREE.MeshStandardMaterial({ color: 0xc58b52, metalness: 0.9, roughness: 0.3 }));
    lug.position.set(0.016, 0, 0.004);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.01, 12).rotateZ(Math.PI / 2), lug.material);
    barrel.position.set(0.005, 0, 0.004);
    grp.add(lug, barrel);
    return out;
  }
  if (n.shape === 'splice') {
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.022, 16).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.35 }));
    sleeve.position.set(0.006, 0, 0.012);
    grp.add(sleeve);
    return out;
  }
  if (n.shape === 'boot') {
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.85 });
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.005, 0.03, 20).rotateZ(Math.PI / 2), rubber);
    boot.position.set(0.016, 0, 0.012);
    const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 20).rotateZ(Math.PI / 2), rubber);
    mouth.position.set(0.032, 0, 0.012);
    grp.add(boot, mouth);
    return out;
  }
  // housing: size from the cavity layout (core/cavity.js, as in the magnified face view), cavities
  // on the front, latch on top, metal holder below. Seen from the front, face x is the housing's +y, face y is up (+z).
  const numbers = n.cavity_numbers ?? Array.from({ length: n.cavities ?? 2 }, (_, i) => String(i + 1));
  const layout = cavityLayout(numbers, 4.5 * k);
  const wy = Math.max(0.012, layout.w / 1000), hz = Math.max(0.012 * k, layout.h / 1000), dx = 0.022 * k;
  const body = new THREE.Mesh(new THREE.BoxGeometry(dx, wy, hz), plastic(HOUSING[n.housing_colour] ?? HOUSING.BK));
  body.position.set(dx / 2, 0, hz / 2 + 0.004);
  grp.add(body);
  const hole = new THREE.BoxGeometry(0.001, 0.0024 * k, 0.0024 * k);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const holes = new THREE.InstancedMesh(hole, holeMat, numbers.length);
  const m = new THREE.Matrix4();
  out.cavities = {};
  layout.cavities.forEach((c, i) => {
    const at = new THREE.Vector3(dx + 0.0003, c.x / 1000, 0.004 + hz / 2 + c.y / 1000);
    m.makeTranslation(at.x, at.y, at.z);
    holes.setMatrixAt(i, m);
    out.cavities[c.n] = at;
  });
  grp.add(holes);
  const latch = new THREE.Mesh(new THREE.BoxGeometry(dx * 0.45, wy * 0.35, 0.002 * k), body.material);
  latch.position.set(dx * 0.6, 0, hz + 0.005);
  grp.add(latch);
  const holder = new THREE.Mesh(new THREE.BoxGeometry(dx * 1.1, wy + 0.006, 0.004), metal);
  holder.position.set(dx / 2, 0, 0.002);
  grp.add(holder);
  return out;
}

function makeLabel(text, width = 0.16) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,24,31,0.85)';
  roundRect(g, 4, 4, 504, 88, 18); g.fill();
  g.fillStyle = '#ffffff';
  g.font = '600 40px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 50, 480);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, toneMapped: false }));
  s.scale.set(width, width * 0.1875, 1);
  return s;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
