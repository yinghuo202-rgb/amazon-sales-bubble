const { MARKETPLACES, day } = require("../core/engine.cjs");
const { scaledRate, demoRate } = require("../core/currency.mjs");
class ExchangeRates {
  constructor(db, fetcher = fetch) {
    this.db = db;
    this.fetcher = fetcher;
    this.inflight = new Map();
  }
  requests(markets, base, extra = []) {
    return [
      ...new Map(
        [
          ...markets.map((m) => ({
            marketplace: m,
            timestamp: new Date().toISOString(),
          })),
          ...extra,
        ].map((e) => {
          const source = MARKETPLACES[e.marketplace].currency,
            date = day(e.timestamp, MARKETPLACES[e.marketplace].zone);
          return [`${date}:${source}:${base}`, { source, target: base, date }];
        }),
      ).values(),
    ];
  }
  demo(markets, base, extra = []) {
    for (const r of this.requests(markets, base, extra))
      this.db.saveRate({
        ...r,
        scope: "demo",
        rateScaled: demoRate(r.source, r.target),
        asOf: r.date,
        provider: "Demo fixture — not a market quote",
      });
  }
  applyGerpGo(rates = [], scope = "live", dates = [new Date().toISOString().slice(0, 10)]) {
    for (const rate of rates) {
      if (!rate || !rate.from || !rate.to || !Number.isFinite(rate.rate) || rate.rate <= 0) continue;
      for (const date of rate.date ? [rate.date] : dates)
        this.db.saveRate({
          date,
          source: String(rate.from).toUpperCase(),
          target: String(rate.to).toUpperCase(),
          scope,
          rateScaled: scaledRate(rate.rate),
          asOf: rate.effectiveDate || rate.date || date,
          provider: "GerpGo OpenAPI",
        });
    }
  }
  async ensure(markets, base, source, extra = []) {
    if (source === "demo") {
      this.demo(markets, base, extra);
      return;
    }
    if (source === "gerpgo")
      throw Error("尚未加载 GerpGo 汇率，请先连接并同步 GerpGo OpenAPI。");
    for (const r of this.requests(markets, base, extra)) {
      if (this.db.rate(r.date, r.source, r.target, "live")) continue;
      const key = JSON.stringify(r);
      if (!this.inflight.has(key))
        this.inflight.set(
          key,
          this.fetchRate(r).finally(() => this.inflight.delete(key)),
        );
      await this.inflight.get(key);
    }
  }
  async fetchRate() { throw Error("外部汇率服务已移除，实时汇率必须来自 GerpGo OpenAPI。"); }
}
module.exports = { ExchangeRates };
