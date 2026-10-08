const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Store } = require("../core/store.cjs");
const { scaledRate, convertMinor } = require("../core/currency.mjs");
const { merge, compress } = require("../core/engine.cjs");
const { Presentation, Phase } = require("../core/presentation.mjs");
const { ExchangeRates } = require("../electron/fx.cjs");
const timestamp = "2026-09-16T12:00:00Z";
const event = (id, extra = {}) => ({
  id,
  type: "ORDER",
  timestamp,
  marketplace: "CA",
  currency: "CAD",
  msku: "MA025",
  quantity: 1,
  amount: 6000,
  baseAmount: 4380,
  salesDelta: 4380,
  ...extra,
});
function clock() {
  let now = 0,
    id = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      timers.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers]
          .filter(([, v]) => v.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
  };
}
test("CAD 60 at .73 is USD 43.80; JPY minor units and rounding are exact", () => {
  assert.equal(convertMinor(6000, "CAD", "USD", scaledRate(0.73)), 4380);
  assert.equal(convertMinor(1000, "JPY", "USD", scaledRate(0.0067)), 670);
  assert.equal(convertMinor(100, "USD", "JPY", scaledRate(149.5)), 150);
  assert.equal(convertMinor(-100, "USD", "JPY", scaledRate(149.5)), -150);
  assert.throws(() => scaledRate(NaN));
});
test("aggregate cannot add currencies without rates; fixed daily rates and conversion provenance persist", () => {
  const db = new Store(":memory:");
  try {
    db.ingest(
      [
        event("ca"),
        event("us", { marketplace: "US", currency: "USD", amount: 10000 }),
      ],
      "live",
    );
    assert.equal(
      db.aggregate(["US", "CA"], "USD", "live", timestamp).total,
      null,
    );
    db.saveRate({
      date: "2026-09-16",
      source: "CAD",
      target: "USD",
      scope: "live",
      rateScaled: scaledRate(0.73),
      asOf: "2026-09-15",
      provider: "test",
    });
    db.saveRate({
      date: "2026-09-16",
      source: "CAD",
      target: "USD",
      scope: "live",
      rateScaled: scaledRate(0.99),
      asOf: "2026-09-16",
      provider: "test",
    });
    assert.equal(
      db.aggregate(["US", "CA"], "USD", "live", timestamp).total,
      15940,
    );
    const conversion = db.db
      .prepare("SELECT * FROM conversions WHERE marketplace='CA'")
      .get();
    assert.equal(conversion.original_amount, 6000);
    assert.equal(conversion.base_amount, 5940);
    assert.equal(conversion.rate_time, "2026-09-16");
    db.ingest([event("refund", { type: "REFUND", amount: 1000 })], "live");
    assert.equal(
      db.aggregate(["US", "CA"], "USD", "live", timestamp).total,
      14950,
    );
    db.db.prepare("DELETE FROM exchange_rates").run();
    const stale = db.aggregate(["US", "CA"], "USD", "live", timestamp);
    assert.equal(stale.complete, false);
    assert.equal(stale.total, 14950);
  } finally {
    db.close();
  }
});
test("merge and compression never mix marketplace or original currency", () => {
  const events = Array.from({ length: 20 }, (_, i) =>
    event(String(i), i % 2 ? { marketplace: "US", currency: "USD" } : {}),
  );
  const merged = merge(events, { ORDER: true });
  assert.equal(merged.length, 2);
  const result = compress(events.map((e) => merge([e])[0]));
  assert.equal(
    result.reduce((s, e) => s + e.amount, 0),
    120000,
  );
  for (const item of result) {
    for (const id of item.ids)
      assert.equal(events[Number(id)].marketplace, item.marketplace);
  }
});
test("authoritative state updates immediately; event content precedes total animation", () => {
  const c = clock(),
    p = new Presentation({ total: 10000, clock: c });
  p.ingest([event("ca")], 14380);
  assert.equal(p.total, 14380);
  assert.equal(p.displayTotal, 10000);
  c.advance(2999);
  assert.equal(p.active, null);
  c.advance(1);
  assert.equal(p.active.currency, "CAD");
  assert.equal(p.active.amount, 6000);
  assert.equal(p.content, "event");
  assert.equal(p.displayTotal, 10000);
  assert.equal(p.phase, Phase.IDLE);
  c.advance(1999);
  assert.equal(p.content, "event");
  assert.equal(p.displayTotal, 10000);
  c.advance(1);
  assert.equal(p.content, "total");
  assert.equal(p.displayTotal, 14380);
  assert.equal(p.previousTotal, 10000);
  assert.equal(p.phase, Phase.UP);
  c.advance(1899);
  assert.equal(p.phase, Phase.UP);
  assert.ok(p.active);
  c.advance(1);
  assert.equal(p.phase, Phase.IDLE);
  assert.equal(p.active, null);
  p.dispose();
});
test("active order is not interrupted by refund; refund takes priority over waiting orders", () => {
  const c = clock(),
    p = new Presentation({ total: 10000, clock: c });
  p.ingest([event("first")], 14380);
  c.advance(3000);
  p.ingest(
    [event("second"), event("refund", { type: "REFUND", salesDelta: -4380 })],
    14380,
  );
  c.advance(1000);
  assert.equal(p.active.id, "first");
  assert.equal(p.content, "event");
  c.advance(1000);
  assert.equal(p.active.id, "first");
  assert.equal(p.content, "total");
  assert.equal(p.phase, Phase.UP);
  c.advance(1400);
  assert.equal(p.active.id, "first");
  c.advance(500);
  assert.equal(p.active, null);
  c.advance(250);
  assert.equal(p.active.type, "REFUND");
  assert.equal(p.content, "event");
  c.advance(2000);
  assert.equal(p.phase, Phase.DOWN);
  assert.equal(p.displayTotal, 10000);
  c.advance(2150);
  assert.equal(p.active.type, "ORDER");
  assert.equal(p.content, "event");
  c.advance(2000);
  assert.equal(p.displayTotal, 14380);
  p.dispose();
});
test("review does not change amount or create a monetary animation; reset cancels pending events", () => {
  const c = clock(),
    p = new Presentation({ total: 10000, clock: c });
  p.ingest(
    [
      event("review", {
        type: "REVIEW",
        rating: 2,
        content: "Stopped working",
        salesDelta: 0,
      }),
    ],
    10000,
  );
  c.advance(3000);
  assert.equal(p.phase, Phase.IDLE);
  assert.equal(p.content, "event");
  assert.equal(p.transitionId, 0);
  assert.equal(p.displayTotal, 10000);
  c.advance(4000);
  assert.equal(p.content, "total");
  assert.equal(p.phase, Phase.IDLE);
  assert.ok(p.active);
  p.reset(9000);
  c.advance(10000);
  assert.equal(p.active, null);
  assert.equal(p.displayTotal, 9000);
  p.dispose();
});
test("GerpGo rate adapter persists documented normalized rates", async () => {
  const db = new Store(":memory:");
  const fx = new ExchangeRates(db);
  try {
    fx.applyGerpGo([{ from: "CAD", to: "USD", rate: 0.73, date: "2026-09-15", effectiveDate: "2026-09-15" }]);
    const r = { date: "2026-09-15", source: "CAD", target: "USD" };
    assert.equal(
      db.rate(r.date, "CAD", "USD", "live").rate_scaled,
      scaledRate(0.73),
    );
  } finally {
    db.close();
  }
});
