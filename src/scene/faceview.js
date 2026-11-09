// Magnified face view of the target connector while a wire end is inserted: the housing front at
// 5x, cavities with their KBL numbers, the target pulsing (guided) and a ghost terminal sliding into
// it on a loop. It lies parallel to the board, FACE_Z above it, so "pushing in" means moving towards
// the board, as when pushing a terminal into a housing lying on the table.
// Face frame: millimetres of the real face (cavityLayout), x right, y up; depth in mm in front of
// the view plane (negative = pushed through).
import * as THREE from 'three';
import { cavityLayout } from '../core/cavity.js';
import { roundRect } from './board.js';
import { t } from '../i18n.js';

export const FACE_SCALE = 5;
const FACE_Z = 0.06; // m above the board surface
const LIFT_MM = 105; // centre of the view this far up the board from the connector (clear of its label)
const LOOP_S = 1.2;
const HOLE_R = 0.36; // hole radius as a fraction of the pitch

export class FaceView {
  constructor(board) {
    this.board = board;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.renderOrder = 5;
    board.group.add(this.group);
    this.layout = null;
    this.flashT = 0;
    this.holes = {};
  }

  // Show the face of connector nodeId with its cavity numbers; guided: highlight and animate target.
  show(nodeId, numbers, target, colour, guided, nodeLabel) {
    this.clear();
    const L = cavityLayout(numbers);
    this.layout = L;
    this.target = String(target);
    this.guided = guided;
    const S = FACE_SCALE / 1000; // real face mm -> metres in the view
    const w = L.w * S, h = L.h * S;
    const at = this.board.pos[nodeId];
    this.origin = this.board.local({ x: at.x, y: at.y + LIFT_MM }, FACE_Z);
    this.group.position.copy(this.origin);

    // housing body behind the face, and the face itself as a canvas (title, numbers, note)
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.014), new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6 }));
    body.position.z = -0.0072;
    this.group.add(body);
    this.faceMat = new THREE.MeshBasicMaterial({ map: this.faceTexture(L, nodeLabel), transparent: true, toneMapped: false });
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.0, h * 1.6), this.faceMat);
    this.face.position.set(0, h * 0.3 - 0.0001, 0.0003);
    this.group.add(this.face);

    const pitch = w / (L.w / 5); // metres per pitch in the view (pitch is 5 mm on the real face)
    const holeGeo = new THREE.CircleGeometry(pitch * HOLE_R, 28);
    for (const c of L.cavities) {
      const m = new THREE.Mesh(holeGeo, new THREE.MeshBasicMaterial({ color: 0x050607, toneMapped: false }));
      m.position.set(c.x * S, c.y * S, 0.0008);
      this.group.add(m);
      this.holes[c.n] = m;
    }
    const ringGeo = new THREE.RingGeometry(pitch * (HOLE_R + 0.04), pitch * (HOLE_R + 0.12), 32);
    this.targetRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, depthWrite: false, toneMapped: false }));
    this.hoverRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    const tc = L.cavities.find((c) => c.n === this.target);
    this.targetRing.position.set(tc.x * S, tc.y * S, 0.001);
    this.hoverRing.visible = false;
    this.group.add(this.targetRing, this.hoverRing);

    // ghost terminal: a tinned flat contact with a short stub of the wire, sliding into the target
    this.ghost = new THREE.Group();
    const ghostMat = (c) => new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.75, roughness: 0.35, metalness: 0.5 });
    const contact = new THREE.Mesh(new THREE.BoxGeometry(pitch * 0.32, pitch * 0.12, pitch * 1.4), ghostMat(0xd8dde3));
    contact.position.z = pitch * 0.7;
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(pitch * 0.14, pitch * 0.14, pitch * 2.4, 12).rotateX(Math.PI / 2), ghostMat(colour));
    stub.position.z = pitch * 2.6;
    this.ghost.add(contact, stub);
    this.ghost.position.set(tc.x * S, tc.y * S, 0);
    this.group.add(this.ghost);
    this.setGuided(guided);

    // red flash overlay for a wrong cavity
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    this.flash.position.z = 0.0012;
    this.group.add(this.flash);
    this.group.visible = true;
  }

  setGuided(on) {
    if (!this.layout) return;
    this.targetRing.visible = on;
    this.ghost.visible = on;
  }

  faceTexture(L, label) {
    const c = document.createElement('canvas');
    const pxPerMm = 24;
    c.width = Math.round(L.w * pxPerMm);
    c.height = Math.round(L.h * 1.6 * pxPerMm);
    const g = c.getContext('2d');
    const top = L.h * 0.6 * pxPerMm; // title band above the face
    g.fillStyle = 'rgba(14,18,25,0.88)';
    roundRect(g, 0, 0, c.width, top - 6, 18); g.fill();
    g.fillStyle = '#2a2d31';
    roundRect(g, 0, top, c.width, c.height - top, 14); g.fill();
    g.fillStyle = '#ffffff';
    g.font = `700 ${Math.round(top * 0.36)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, c.width / 2, top * 0.34, c.width - 20);
    g.fillStyle = '#9aa7b8';
    g.font = `${Math.round(top * 0.2)}px system-ui, sans-serif`;
    g.fillText(t('schematic'), c.width / 2, top * 0.74, c.width - 20);
    // cavity numbers just below each hole
    g.fillStyle = '#e9eef5';
    g.font = `600 ${Math.round(pxPerMm * 1.5)}px system-ui, sans-serif`;
    for (const cv of L.cavities) {
      const x = (cv.x + L.w / 2) * pxPerMm, y = top + (L.h / 2 - cv.y) * pxPerMm + pxPerMm * 2.55;
      g.fillText(cv.n, x, y);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Board-local point (metres) -> { p: real face mm, depth: mm in front of the view }.
  toFace(local) {
    if (!this.layout || !local) return null;
    const d = local.clone().sub(this.origin);
    return { p: { x: (d.x * 1000) / FACE_SCALE, y: (d.y * 1000) / FACE_SCALE }, depth: d.z * 1000 };
  }

  // Is a board-local point close enough to pick the wire end up again at the view?
  near(local) {
    const f = this.toFace(local);
    if (!f) return false;
    return Math.abs(f.p.x) < this.layout.w / 2 + 8 && Math.abs(f.p.y) < this.layout.h / 2 + 8 && f.depth > -60 && f.depth < 90;
  }

  hover(n) {
    const c = n !== null && this.layout?.cavities.find((x) => x.n === n);
    this.hoverRing.visible = !!c;
    if (c) this.hoverRing.position.set((c.x * FACE_SCALE) / 1000, (c.y * FACE_SCALE) / 1000, 0.0011);
  }

  wrong() { this.flashT = 0.45; }

  fill(n, colour) {
    this.holes[n]?.material.color.setHex(colour);
  }

  clear() {
    this.group.traverse((o) => {
      if (o === this.group) return;
      o.geometry?.dispose();
      for (const m of [o.material].flat()) { m?.map?.dispose(); m?.dispose(); }
    });
    this.group.clear();
    this.holes = {};
    this.layout = null;
    this.group.visible = false;
  }

  hide() { this.clear(); }

  update(dt, time) {
    if (!this.layout) return;
    this.targetRing.material.opacity = 0.55 + 0.4 * Math.sin(time * 6);
    if (this.ghost.visible) {
      const k = (time % LOOP_S) / LOOP_S; // slide in, rest, fade
      const pitch = (FACE_SCALE * 5) / 1000;
      this.ghost.position.z = pitch * 3 * (1 - Math.min(1, k / 0.7)) - pitch * 0.9 * Math.min(1, k / 0.7);
      const fade = k < 0.85 ? 1 : 1 - (k - 0.85) / 0.15;
      this.ghost.traverse((o) => { if (o.isMesh) o.material.opacity = 0.75 * fade; });
    }
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.flash.material.opacity = (this.flashT / 0.45) * 0.55;
    }
  }
}
