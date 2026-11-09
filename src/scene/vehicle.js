// Vehicle view: the full VW harness at 1:1 in vehicle coordinates, with the formboard harness
// highlighted where it sits in the car. Built from tools/real_kbl.py vehicle() output (metres, y up).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function tubes(segments, scale = 1) {
  const geos = segments.map((s) => {
    const pts = s.pts.map((p) => new THREE.Vector3(...p));
    const path = pts.length === 2 ? [pts[0], pts[0].clone().lerp(pts[1], 0.5), pts[1]] : pts;
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), Math.max(4, path.length * 2), (s.r / 1000) * scale, 6, false);
  });
  return mergeGeometries(geos);
}

function sign(lines, width = 1024) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = 64 + lines.length * 52;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(14,18,25,0.85)';
  g.fillRect(0, 0, c.width, c.height);
  lines.forEach(([text, colour, size], i) => {
    g.fillStyle = colour;
    g.font = `${i ? 400 : 700} ${size}px system-ui, sans-serif`;
    g.fillText(text, 32, 58 + i * 52, width - 64);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, (1.2 * c.height) / c.width), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false }));
  return m;
}

function label(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(14,18,25,0.85)';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#ffd29a';
  g.font = '600 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, toneMapped: false }));
  s.scale.set(0.12, 0.03, 1);
  return s;
}

const DEFAULT = 'vw_movo.json';

export class VehicleView {
  constructor(data) {
    this.group = new THREE.Group();
    const full = new THREE.Mesh(tubes(data.full), new THREE.MeshStandardMaterial({ color: 0x9fb0c4, roughness: 0.55 }));
    this.glow = new THREE.MeshStandardMaterial({ color: 0xf07b16, emissive: 0xf07b16, emissiveIntensity: 0.6, roughness: 0.4 });
    this.group.add(full);
    // Highlights: the default one (the ignition harness, highlight) and pieces cut out of the full
    // harness (data.pieces, by harness file). One is shown at a time, for the harness being built.
    this.pieces = {};
    const build = (hl, connectors, id) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(tubes(hl, 1.6), this.glow));
      for (const c of connectors) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffd29a }));
        dot.position.set(...c.p);
        const l = label(c.label);
        l.position.set(c.p[0], c.p[1] + 0.035, c.p[2]);
        g.add(dot, l);
      }
      g.visible = false;
      this.group.add(g);
      return { g, id };
    };
    this.pieces[DEFAULT] = build(data.highlight, data.connectors, data.highlight_id);
    for (const [file, pc] of Object.entries(data.pieces ?? {})) this.pieces[file] = build(pc.highlight, pc.connectors, pc.highlight_id);
    this.setPiece(DEFAULT);

    // Approximate vehicle footprint on the floor for scale (Beetle: about 4.1 m x 1.55 m).
    const outline = new THREE.Mesh(new THREE.RingGeometry(0.98, 1, 64), new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.35 }));
    outline.rotation.x = -Math.PI / 2;
    outline.scale.set(2.05, 0.78, 1);
    outline.position.y = -this.liftM + 0.003;
    this.group.add(outline);

    this.data = data;
    this.sign = null;
  }

  // Sign above the car; texts come from the app (language). Four lines: title, two facts, source.
  setSign(texts, lookAt) {
    const s = sign([[texts[0], '#ffffff', 40], [texts[1], '#c5ceda', 30], [texts[2], '#f7a35c', 30], [texts[3], '#9aa7b8', 26]]);
    s.position.set(0, 1.2, 0);
    if (this.sign) {
      this.group.remove(this.sign);
      this.sign.geometry.dispose();
      this.sign.material.map.dispose();
      this.sign.material.dispose();
    }
    this.sign = s;
    this.group.add(s);
    this.group.updateMatrixWorld(true);
    s.lookAt(lookAt);
  }

  // Show the highlight for this harness file (the default one for harnesses not in the car data).
  setPiece(file) {
    this.pieceFile = this.pieces[file] ? file : DEFAULT;
    for (const [f, p] of Object.entries(this.pieces)) p.g.visible = f === this.pieceFile;
  }

  get pieceId() { return this.pieces[this.pieceFile].id; }

  get liftM() { return 0.35; } // harness z=0 sits about this high above the road

  update(t) {
    this.glow.emissiveIntensity = 0.45 + 0.3 * Math.sin(t * 3);
  }
}
