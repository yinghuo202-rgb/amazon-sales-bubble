import { merge, compress, group, MARKETPLACES } from "./engine.mjs";
export const Phase = Object.freeze({
  IDLE: "IDLE",
  UP: "AMOUNT_INCREASING",
  DOWN: "AMOUNT_DECREASING",
});
export const TIMING = Object.freeze({
  merge: 3000,
  event: 2000,
  review: 4000,
  amount: 600,
  color: 1000,
  return: 300,
  rest: 250,
});
const nativeClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};
export class Presentation {
  constructor({
    total = 0,
    onChange = () => {},
    onDisplay = () => {},
    clock = nativeClock,
    timing = {},
  } = {}) {
    Object.assign(this, {
      total,
      displayTotal: total,
      previousTotal: total,
      onChange,
      onDisplay,
      clock,
    });
    this.timing = { ...TIMING, ...timing };
    this.phase = Phase.IDLE;
    this.queue = [];
    this.pending = [];
    this.recent = [];
    this.active = null;
    this.content = "total";
    this.revision = 0;
    this.transitionId = 0;
    this.timer = null;
    this.colorTimer = null;
    this.mergeTimer = null;
    this.disposed = false;
  }
  snapshot() {
    return {
      phase: this.phase,
      total: this.total,
      displayTotal: this.displayTotal,
      previousTotal: this.previousTotal,
      active: this.active,
      content: this.content,
      queue: this.queue.length,
      pending: this.pending.length,
      revision: this.revision,
      transitionId: this.transitionId,
    };
  }
  emit() {
    if (!this.disposed) {
      this.revision++;
      this.onChange(this.snapshot());
    }
  }
  ingest(events, total) {
    if (this.disposed) return;
    const correction =
      total - this.total - events.reduce((s, e) => s + (e.salesDelta || 0), 0);
    this.total = total;
    this.displayTotal += correction;
    this.previousTotal += correction;
    this.pending.push(...events);
    const now = this.clock.now();
    this.recent = this.recent.filter((e) => now - e.at < 10000);
    this.recent.push(
      ...events.map((e) => ({
        type: e.type,
        marketplace: e.marketplace,
        id: e.transactionId || e.orderId || e.id,
        at: now,
      })),
    );
    if (this.pending.length && !this.mergeTimer)
      this.mergeTimer = this.clock.setTimeout(
        () => this.flush(),
        this.timing.merge,
      );
    this.emit();
  }
  flush() {
    this.mergeTimer = null;
    const now = this.clock.now();
    this.recent = this.recent.filter((e) => now - e.at <= 10000);
    const high = {};
    for (const type of ["ORDER", "REFUND"])
      high[type] =
        new Set(
          this.recent
            .filter((e) => e.type === type)
            .map((e) => e.marketplace + e.id),
        ).size >= 5;
    let waiting = [...this.queue, ...merge(this.pending, high)];
    this.pending = [];
    for (const type of ["ORDER", "REFUND"])
      if (high[type])
        for (const market of Object.keys(MARKETPLACES)) {
          const same = waiting.filter(
            (e) => e.type === type && e.marketplace === market,
          );
          if (same.length > 1)
            waiting = [
              ...waiting.filter(
                (e) => !(e.type === type && e.marketplace === market),
              ),
              group(same, "batch"),
            ];
        }
    this.queue = compress(waiting);
    if (!this.active && !this.timer) this.next();
    else this.emit();
  }
  next() {
    this.timer = null;
    this.active = this.queue.shift() || null;
    if (!this.active) {
      this.content = "total";
      this.phase = Phase.IDLE;
      if (!this.pending.length) this.displayTotal = this.total;
      this.emit();
      return;
    }
    this.content = "event";
    this.onDisplay(this.active);
    this.phase = Phase.IDLE;
    this.emit();
    const dwell =
      this.active.type === "REVIEW" ? this.timing.review : this.timing.event;
    this.timer = this.clock.setTimeout(() => this.beginTotal(), dwell);
  }
  beginTotal() {
    this.timer = null;
    if (!this.active) return;
    this.content = "total";
    const delta = this.active.salesDelta || 0;
    if (delta) {
      this.previousTotal = this.displayTotal;
      this.displayTotal += delta;
      this.phase = delta > 0 ? Phase.UP : Phase.DOWN;
      this.transitionId++;
      this.colorTimer = this.clock.setTimeout(
        () => {
          this.phase = Phase.IDLE;
          this.emit();
        },
        this.timing.amount + this.timing.color + this.timing.return,
      );
      this.emit();
      this.timer = this.clock.setTimeout(
        () => this.finish(),
        this.timing.amount + this.timing.color + this.timing.return,
      );
    } else {
      this.phase = Phase.IDLE;
      this.emit();
      this.timer = this.clock.setTimeout(
        () => this.finish(),
        this.timing.return,
      );
    }
  }
  finish() {
    this.timer = null;
    this.active = null;
    this.content = "total";
    this.phase = Phase.IDLE;
    if (!this.pending.length && !this.queue.length)
      this.displayTotal = this.total;
    this.emit();
    this.timer = this.clock.setTimeout(() => this.next(), this.timing.rest);
  }
  reset(total) {
    this.clock.clearTimeout(this.timer);
    this.clock.clearTimeout(this.colorTimer);
    this.clock.clearTimeout(this.mergeTimer);
    this.timer = null;
    this.mergeTimer = null;
    this.pending = [];
    this.queue = [];
    this.recent = [];
    this.active = null;
    this.content = "total";
    this.total = total;
    this.displayTotal = total;
    this.previousTotal = total;
    this.phase = Phase.IDLE;
    this.emit();
  }
  dispose() {
    this.clock.clearTimeout(this.timer);
    this.clock.clearTimeout(this.colorTimer);
    this.clock.clearTimeout(this.mergeTimer);
    this.disposed = true;
  }
}
