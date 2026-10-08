const { setTimeout: delay } = require("node:timers/promises");
const { asGerpGoError } = require("./errors.cjs");

class GerpGoPoller {
  constructor({ source, cursorStore, onEvents, onSnapshot, onStatus, intervalMs = 30000, reconciliationMs = 300000, now = () => new Date() }) {
    this.source = source;
    this.cursorStore = cursorStore;
    this.onEvents = onEvents || (() => {});
    this.onSnapshot = onSnapshot || (() => {});
    this.onStatus = onStatus || (() => {});
    this.intervalMs = Math.max(15000, intervalMs);
    this.reconciliationMs = Math.max(this.intervalMs, reconciliationMs);
    this.now = now;
    this.stopped = false;
    this.timer = null;
    this.reconcileTimer = null;
    this.failures = 0;
    this.initialized = false;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.reconcileTimer);
  }

  async runOnce() {
    if (this.stopped) return;
    try {
      this.onStatus("syncing");
      const events = [];
      const resources = [
        ["orders", "getOrdersSince"],
        ["refunds", "getRefundsSince"],
        ["reviews", "getReviewsSince"],
      ];
      const errors = [];
      for (const [resource, method] of resources) {
        if (this.source.capabilities && this.source.capabilities[resource] === false) continue;
        const cursor = this.cursorStore?.get?.(`gerpgo:${resource}`, null) || null;
        try {
          const result = await this.source[method](cursor);
          events.push(...(result?.events || []));
          if (result?.cursor !== undefined) {
            this.cursorStore?.set?.(`gerpgo:${resource}`, result.cursor);
          }
        } catch (error) {
          if (error.code !== "UNSUPPORTED_CAPABILITY") errors.push(error);
        }
      }
      if (!this.initialized) await this.onEvents(events, true);
      else await this.onEvents(events, false);
      this.initialized = true;
      if (errors.length) {
        this.failures++;
        this.onStatus("error", asGerpGoError(errors[0]).message);
      } else {
        this.failures = 0;
        this.onStatus("connected");
      }
    } catch (error) {
      const normalized = asGerpGoError(error);
      if (normalized.code === "UNSUPPORTED_CAPABILITY") this.onStatus("connected", "当前账户未提供该数据能力");
      else { this.failures++; this.onStatus("error", normalized.message); }
    }
    if (!this.stopped) this.timer = setTimeout(() => this.runOnce(), Math.min(900000, this.intervalMs * 2 ** this.failures));
  }

  async reconcile() {
    if (this.stopped) return;
    try {
      const groups = this.source.salesDateGroups?.(this.now()) || [{ businessDate: this.now().toISOString().slice(0, 10) }];
      const snapshots = [];
      for (const group of groups) {
        snapshots.push(await this.source.getTodaySales(group));
      }
      if (snapshots.length) {
        const first = snapshots[0];
        await this.onSnapshot({
          ...first,
          businessDate: this.now().toISOString().slice(0, 10),
          total: snapshots.reduce((sum, snapshot) => sum + Number(snapshot.total || 0), 0),
          markets: snapshots.flatMap((snapshot) => snapshot.markets || []),
          source: "gerpgo-statistics",
        });
      }
    }
    catch (error) { const normalized = asGerpGoError(error); if (normalized.code !== "UNSUPPORTED_CAPABILITY") this.onStatus("error", normalized.message); }
    if (!this.stopped) this.reconcileTimer = setTimeout(() => this.reconcile(), this.reconciliationMs);
  }

  // The initial order feed and sales snapshot must be serialized. Starting
  // both at once lets an empty/lagging statistics response overwrite the
  // total that the order feed has just populated.
  async start() {
    this.stopped = false;
    await this.runOnce();
    if (!this.stopped) await this.reconcile();
  }
}

module.exports = { GerpGoPoller };
