// Assembly session state machine: menu -> prep -> route (one wire per step) -> qa -> summary.
// Holds the metrics that end up in the log. Time comes in as an argument (ms) for testability.
import { wiresForVariant, pegsFor } from './harness.js';

export const QA_ITEMS = [
  'All connectors seated and locked',
  'Bundles tight, no loose loops',
  'Wire colours match the drawing',
];

export class Session {
  constructor(harness) {
    this.h = harness;
    this.state = 'menu';
    this.variant = null;
    this.mode = 'guided';
    this.wires = [];
    this.pegs = [];
    this.pegsSet = new Set();
    this.index = 0;
    this.metrics = [];
    this.qa = new Set();
    this.startedAt = 0;
    this.finishedAt = 0;
  }

  get wire() { return this.state === 'route' ? this.wires[this.index] : null; }

  start(variant, mode, now) {
    this.variant = variant;
    this.mode = mode;
    this.wires = wiresForVariant(this.h, variant);
    this.pegs = pegsFor(this.h, this.wires);
    this.pegsSet = new Set();
    this.metrics = [];
    this.qa = new Set();
    this.index = 0;
    this.startedAt = now;
    this.state = 'prep';
  }

  setPeg(id, now) {
    if (this.state !== 'prep' || !this.pegs.some((p) => p.id === id)) return false;
    this.pegsSet.add(id);
    if (this.pegsSet.size === this.pegs.length) this.beginRouting(now);
    return true;
  }

  setAllPegs(now) {
    for (const p of this.pegs) this.pegsSet.add(p.id);
    this.beginRouting(now);
  }

  beginRouting(now) {
    this.state = 'route';
    this.index = 0;
    this.metrics = this.wires.map((w) => ({ wire: w.id, cavity: w.to, start: null, end: null, errors: 0, cavity_errors: 0, hints: 0 }));
    this.metrics[0].start = now;
  }

  hint() {
    if (this.state === 'route') this.metrics[this.index].hints++;
  }

  // errors: routing errors (wrong peg); cavityErrors: wrong cavities while inserting the end.
  wireDone(errors, now, cavityErrors = 0) {
    if (this.state !== 'route') return;
    const m = this.metrics[this.index];
    m.end = now;
    m.errors = errors;
    m.cavity_errors = cavityErrors;
    if (this.index + 1 < this.wires.length) {
      this.index++;
      this.metrics[this.index].start = now;
    } else {
      this.state = 'qa';
    }
  }

  // Undo the previous wire (or leave QA back to the last wire).
  back(now) {
    if (this.state === 'qa') {
      this.state = 'route';
    } else if (this.state === 'route' && this.index > 0) {
      this.metrics[this.index] = { ...this.metrics[this.index], start: null, end: null, errors: 0, cavity_errors: 0, hints: 0 };
      this.index--;
    } else {
      return;
    }
    this.metrics[this.index] = { ...this.metrics[this.index], start: now, end: null, errors: 0, cavity_errors: 0, hints: 0 };
  }

  checkQa(i, now) {
    if (this.state !== 'qa') return;
    this.qa.has(i) ? this.qa.delete(i) : this.qa.add(i);
    if (this.qa.size === QA_ITEMS.length) {
      this.state = 'summary';
      this.finishedAt = now;
    }
  }

  restart() {
    this.state = 'menu';
  }

  summary() {
    const done = this.metrics.filter((m) => m.end !== null);
    return {
      harness: this.h.id,
      variant: this.variant?.label,
      mode: this.mode,
      total_s: round((this.finishedAt - this.startedAt) / 1000),
      errors: done.reduce((a, m) => a + m.errors, 0),
      cavity_errors: done.reduce((a, m) => a + m.cavity_errors, 0),
      hints: done.reduce((a, m) => a + m.hints, 0),
      wires: done.map((m) => ({ wire: m.wire, cavity: m.cavity, time_s: round((m.end - m.start) / 1000), errors: m.errors, cavity_errors: m.cavity_errors, hints: m.hints })),
    };
  }
}

function round(x) {
  return Math.round(x * 10) / 10;
}
