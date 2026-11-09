// Procedural workshop: floor, walls, workbench, easel legs and lights. No external assets.
import * as THREE from 'three';

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3d42';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) {
    const v = 50 + Math.random() * 20;
    g.fillStyle = `rgba(${v},${v + 2},${v + 6},0.35)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 8);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorkshop(scene) {
  scene.background = new THREE.Color(0x1b1f26);
  // Room decor, hidden in mixed reality (the real room takes its place). Lights stay.
  const decor = new THREE.Group();
  scene.add(decor);
  scene.fog = new THREE.Fog(0x1b1f26, 6, 14);

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 0.5));
  // Overhead work light: the only shadow caster, its shadow box fitted tightly around the board.
  const key = new THREE.DirectionalLight(0xfff4e6, 1.5);
  key.position.set(0.6, 2.8, 0.9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -0.7, right: 0.7, top: 0.7, bottom: -0.7, near: 1, far: 5 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.01;
  scene.add(key, key.target);
  const fill = new THREE.PointLight(0x9fd0ff, 6, 4);
  fill.position.set(-1, 2.2, -0.2);
  scene.add(fill);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.75 }));
  floor.receiveShadow = true;
  floor.rotation.x = -Math.PI / 2;
  decor.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 1 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), wallMat);
  back.position.set(0, 2, -3);
  decor.add(back);
  // Safety marking around the workstation, like tape on a shop floor.
  const tape = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.5, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({ color: 0xf2c80f }));
  tape.rotation.x = -Math.PI / 2;
  tape.position.set(0, 0.002, -0.35);
  tape.scale.set(1.2, 0.8, 1);
  decor.add(tape);

  const metal = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.7, roughness: 0.35 });
  const top = new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.6 });

  // Workbench in front of the board.
  const bench = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.5), top);
  plate.receiveShadow = true;
  plate.position.y = 0.72;
  bench.add(plate);
  for (const [x, z] of [[-0.75, -0.2], [0.75, -0.2], [-0.75, 0.2], [0.75, 0.2]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.05), metal);
    leg.position.set(x, 0.36, z);
    bench.add(leg);
  }
  bench.position.set(0, 0, -0.45);
  decor.add(bench);

  // Wire spool rack next to the bench, as set dressing.
  const rack = new THREE.Group();
  const colours = [0xd7263d, 0x7b4a2a, 0x1f6fd1, 0x2e9e4f, 0xf2c80f, 0xf4f4f4, 0x8e44ad, 0xf07b16];
  colours.forEach((c, i) => {
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 24), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    spool.rotation.z = Math.PI / 2;
    spool.position.set((i % 4) * 0.09 - 0.135, 0.8 + Math.floor(i / 4) * 0.14, 0);
    rack.add(spool);
  });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.02), metal);
  bar.position.set(0, 0.72, 0);
  rack.add(bar);
  for (const x of [-0.2, 0.2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.72, 0.02), metal);
    post.position.set(x, 0.36, 0);
    rack.add(post);
  }
  rack.position.set(-1.75, 0, -1.25);
  rack.rotation.y = 0.5;
  decor.add(rack);

  return { metal, key, decor };
}
