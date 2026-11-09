// Mixed reality: find the real table the user looks at (WebXR hit-test against the Quest's room
// scan from Space Setup). Without hit-test results, the gaze meets a plane at table height instead.
// The maths (is it a table, which way to face) is in core/placement.js.
import * as THREE from 'three';
import { stationPose, fallbackPoint } from '../core/placement.js';

export class Placement {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.source = null;
    this.active = false;
    this.onSurface = false; // last pose came from a detected surface (not the fallback)
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.075, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.reticle.renderOrder = 11;
    this.reticle.visible = false;
    scene.add(this.reticle);
  }

  async begin(session) {
    this.active = true;
    if (this.source || !session.requestHitTestSource) return;
    try {
      const viewer = await session.requestReferenceSpace('viewer');
      this.source = await session.requestHitTestSource({ space: viewer });
    } catch {
      this.source = null; // hit-test not granted: the fallback plane still works
    }
  }

  end() {
    this.active = false;
    this.reticle.visible = false;
  }

  // Drop the hit-test source when the session ends.
  reset() {
    this.source?.cancel?.();
    this.source = null;
    this.end();
  }

  // Pose for the workstation this frame ({x, y, z, yaw}), or null.
  update() {
    if (!this.active) return null;
    const cam = this.renderer.xr.getCamera();
    const head = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    let pose = null;
    const frame = this.renderer.xr.getFrame();
    const space = this.renderer.xr.getReferenceSpace();
    if (this.source && frame && space) {
      for (const r of frame.getHitTestResults(this.source)) {
        const p = r.getPose(space);
        if (!p) continue;
        const { position: q, orientation: o } = p.transform;
        const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w));
        pose = stationPose({ x: q.x, y: q.y, z: q.z }, normal, head);
        if (pose) break;
      }
    }
    this.onSurface = !!pose;
    if (!pose) {
      const dir = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
      const point = fallbackPoint(head, dir);
      if (point) pose = stationPose(point, null, head);
    }
    this.reticle.visible = !!pose;
    if (pose) this.reticle.position.set(pose.x, pose.y + 0.003, pose.z);
    return pose;
  }
}
