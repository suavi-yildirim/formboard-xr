// Inserting a wire end into its cavity. Feed it the fingertip on the connector face (face mm, same
// frame as cavityLayout) and how far it is in front of the face (mm, negative = behind). A push is
// counted when the tip goes from in front of the face to more than PUSH_MM behind it, over a cavity.
// Arriving from behind (the hand reaching round the connector) never counts. No rendering, no timing.
import { CAVITY_PITCH_MM } from './cavity.js';

export const PUSH_MM = 8;

export class InsertAttempt {
  // radius: how close to a cavity centre a push must be (default: half the pitch, so every point
  // of the face belongs to at most one cavity).
  constructor(layout, target, radius = CAVITY_PITCH_MM / 2) {
    this.layout = layout;
    this.target = String(target);
    this.radius = radius;
    this.holding = false;
    this.armed = false; // the tip was in front of the face since the last push
    this.hovered = null;
    this.errors = 0;
    this.done = false;
  }

  cavityAt(p) {
    if (!p) return null;
    let best = null, bestD = this.radius;
    for (const c of this.layout.cavities) {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d <= bestD) { best = c.n; bestD = d; }
    }
    return best;
  }

  // held: the user holds the wire end (the caller decides when a pinch picks it up).
  update(p, held, depth) {
    const events = [];
    if (this.done) return events;
    if (!held) {
      if (this.holding) events.push({ type: 'release' });
      this.holding = false;
      this.armed = false;
      this.hovered = null;
      return events;
    }
    if (!this.holding) {
      this.holding = true;
      events.push({ type: 'grab' });
    }
    const over = this.cavityAt(p);
    if (over !== this.hovered) {
      this.hovered = over;
      if (over !== null) events.push({ type: 'hover', at: over });
    }
    if (depth > 0) {
      this.armed = true;
    } else if (depth < -PUSH_MM && this.armed && over !== null) {
      this.armed = false;
      if (over === this.target) {
        this.done = true;
        this.holding = false;
        events.push({ type: 'inserted', at: over });
      } else {
        this.errors++;
        events.push({ type: 'wrong', at: over, expected: this.target });
      }
    }
    return events;
  }
}
