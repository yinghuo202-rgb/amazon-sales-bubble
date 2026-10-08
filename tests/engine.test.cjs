const { test } = require("node:test");
const assert = require("node:assert/strict");
const { merge, compress, day, validate } = require("../core/engine.cjs");
const { Store } = require("../core/store.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { mapRefunds } = require("../electron/gerpgo/refunds.cjs");
const { mapReviews } = require("../electron/gerpgo/reviews.cjs");
const e = (id, type = "ORDER", extra = {}) => ({
  id,
  type,
  timestamp: "2026-09-16T12:00:00Z",
  marketplace: "US",
  msku: "MA025",
  quantity: 1,
  amount: 3999,
  ...extra,
});
test("same SKU merges quantity and integer amount", () => {
  const result = merge([e("1"), e("2")]);
  assert.equal(result.length, 1);
  assert.equal(result[0].quantity, 2);
  assert.equal(result[0].amount, 7998);
});
test("different SKUs stay separate for two events, summarize for three", () => {
  assert.equal(merge([e("1"), e("2", "ORDER", { msku: "B" })]).length, 2);
  assert.equal(
    merge([e("1"), e("2", "ORDER", { msku: "B" }), e("3")])[0].style,
    "summary",
  );
});
test("orders refunds and reviews never net together", () => {
  const result = merge([
    e("1"),
    e("2", "REFUND"),
    e("3", "REVIEW", { rating: 1, content: "Bad" }),
  ]);
  assert.deepEqual(
    result.map((e) => e.type),
    ["REFUND", "REVIEW", "ORDER"],
  );
});
test("low-star review appears before remainder", () => {
  const result = merge([
    e("1", "REVIEW", { rating: 5 }),
    e("2", "REVIEW", { rating: 1 }),
    e("3", "REVIEW", { rating: 3 }),
  ]);
  assert.equal(result[0].id, "2");
  assert.equal(result[1].count, 2);
  assert.equal(result[1].style, "summary");
});
test("queue compression preserves money and all ids", () => {
  const input = Array.from(
    { length: 20 },
    (_, i) => merge([e(String(i), i % 2 ? "REFUND" : "ORDER")])[0],
  );
  const result = compress(input);
  assert.ok(result.length <= 5);
  assert.equal(
    result.reduce((s, e) => s + e.amount, 0),
    20 * 3999,
  );
  assert.equal(result.flatMap((e) => e.ids).length, 20);
});
test("batch mode summarizes high frequency orders", () => {
  const result = merge([e("1"), e("2")], { ORDER: true });
  assert.equal(result[0].style, "batch");
});
test("reporting date uses marketplace timezone and DST", () => {
  assert.equal(
    day("2026-09-16T06:59:00Z", "America/Los_Angeles"),
    "2026-09-15",
  );
  assert.equal(
    day("2026-09-16T07:00:00Z", "America/Los_Angeles"),
    "2026-09-16",
  );
  assert.equal(
    day("2026-01-16T07:59:00Z", "America/Los_Angeles"),
    "2026-01-15",
  );
});
test("SQLite deduplicates, separates modes and corrects canceled orders", () => {
  const s = new Store(":memory:");
  assert.equal(s.ingest([e("1")], "live", true).length, 0);
  assert.equal(s.ingest([e("1")], "live").length, 0);
  assert.equal(s.total("US", "live", "2026-09-16T14:00:00Z"), 3999);
  s.ingest([e("1")], "demo");
  s.ingest([e("2", "REFUND")], "live");
  assert.equal(s.total("US", "live", "2026-09-16T14:00:00Z"), 0);
  assert.equal(s.total("US", "demo", "2026-09-16T14:00:00Z"), 3999);
  s.ingest([e("1", "ORDER", { status: "Canceled" })], "live");
  assert.equal(s.total("US", "live", "2026-09-16T14:00:00Z"), -3999);
  s.close();
});
test("atomic rollback on invalid event", () => {
  const s = new Store(":memory:");
  assert.throws(() =>
    s.ingest([e("1"), e("2", "ORDER", { amount: NaN })], "live"),
  );
  assert.equal(s.total("US", "live"), 0);
  assert.equal(s.ingest([e("1")], "live").length, 1);
  s.close();
});
test("reviews never change sales", () => {
  const s = new Store(":memory:");
  s.ingest([e("1", "REVIEW", { rating: 2, content: "text" })], "live");
  assert.equal(s.total("US", "live", "2026-09-16T14:00:00Z"), 0);
  s.close();
});
test("normalized money remains integer and rejects missing amount", () => {
  assert.throws(() => validate(e("1", "ORDER", { amount: 3.5 })));
  assert.throws(() => validate(e("1", "ORDER", { amount: undefined })));
});
test("official refund and review rows map without buyer PII", () => {
  const stores = new Map([["1", { marketplaceCode: "US" }]]);
  const refunds = mapRefunds({ data: { rows: [{ marketId: 1, orderId: "o1", msku: "A", currency: "USD", price: 3.99, settlementTimeMarket: "2026-09-21 10:00:00", typeDetail: "Refund" }] } }, stores);
  const reviews = mapReviews({ data: { rows: [{ marketId: 1, reviewId: "r1", product: "A", star: 2, content: "bad", reviewDate: "2026-09-21" }] } }, stores);
  assert.equal(refunds[0].amount, 399);
  assert.equal(reviews[0].rating, 2);
  assert.equal("buyerEmail" in reviews[0], false);
});
test("restart restores sales and suppresses old notifications", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "amazon-vision-test-"));
  const file = path.join(folder, "events.sqlite");
  let store = new Store(file);
  try {
    store.ingest([e("persist")], "live");
    store.mark([e("persist")], "live");
    store.close();
    store = new Store(file);
    assert.equal(store.total("US", "live", "2026-09-16T14:00:00Z"), 3999);
    assert.equal(store.ingest([e("persist")], "live").length, 0);
    assert.equal(
      store.db.prepare("SELECT displayed FROM events").get().displayed,
      1,
    );
  } finally {
    store.close();
    fs.unlinkSync(file);
    fs.rmdirSync(folder);
  }
});
