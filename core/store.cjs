const { DatabaseSync } = require("node:sqlite");
const { validate, day, MARKETPLACES } = require("./engine.cjs");
const { convertMinor, SCALE } = require("./currency.mjs");
class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS events(id TEXT NOT NULL,type TEXT NOT NULL,marketplace TEXT NOT NULL,mode TEXT NOT NULL,payload TEXT NOT NULL,processed INTEGER DEFAULT 1,displayed INTEGER DEFAULT 0,PRIMARY KEY(id,type,marketplace,mode)); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS daily_summary(date TEXT,marketplace TEXT,mode TEXT,gross_sales INTEGER,refund_amount INTEGER,sales INTEGER,PRIMARY KEY(date,marketplace,mode)); CREATE TABLE IF NOT EXISTS stores(provider TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,marketplace_code TEXT NOT NULL,country_code TEXT,currency TEXT,enabled INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,PRIMARY KEY(provider,id)); CREATE TABLE IF NOT EXISTS sales_snapshots(provider TEXT NOT NULL,business_date TEXT NOT NULL,base_currency TEXT NOT NULL,total INTEGER NOT NULL,source TEXT NOT NULL,fetched_at TEXT NOT NULL,raw_hash TEXT,PRIMARY KEY(provider,business_date,base_currency)); CREATE TABLE IF NOT EXISTS sync_state(provider TEXT NOT NULL,resource_type TEXT NOT NULL,store_id TEXT NOT NULL,cursor TEXT,last_success_at TEXT,last_attempt_at TEXT,last_error TEXT,PRIMARY KEY(provider,resource_type,store_id));`,
    );
    // Backfill only databases created before the indexed reporting date existed.
    this.db.exec("BEGIN");
    try {
      for (const row of this.db
        .prepare(
          "SELECT rowid,payload FROM events WHERE json_extract(payload,'$._day') IS NULL",
        )
        .all()) {
        const event = JSON.parse(row.payload);
        event._day = day(event.timestamp, MARKETPLACES[event.marketplace].zone);
        this.db
          .prepare("UPDATE events SET payload=? WHERE rowid=?")
          .run(JSON.stringify(event), row.rowid);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.db
      .exec(`CREATE INDEX IF NOT EXISTS events_daily ON events(marketplace,mode,json_extract(payload,'$._day'));
      CREATE INDEX IF NOT EXISTS events_order ON events(marketplace,mode,json_extract(payload,'$.orderId'));
      CREATE VIEW IF NOT EXISTS orders AS SELECT id AS order_item_key, marketplace, mode, json_extract(payload,'$.orderId') AS order_id, json_extract(payload,'$.itemId') AS order_item_id, json_extract(payload,'$.msku') AS msku, json_extract(payload,'$.quantity') AS quantity, json_extract(payload,'$.amount') AS amount, json_extract(payload,'$.timestamp') AS timestamp, json_extract(payload,'$.status') AS status FROM events WHERE type='ORDER';
      CREATE VIEW IF NOT EXISTS refunds AS SELECT id AS refund_id,marketplace,mode,json_extract(payload,'$.orderId') AS order_id,json_extract(payload,'$.msku') AS msku,json_extract(payload,'$.quantity') AS quantity,json_extract(payload,'$.amount') AS amount,json_extract(payload,'$.timestamp') AS timestamp FROM events WHERE type='REFUND';
      CREATE VIEW IF NOT EXISTS reviews AS SELECT id AS review_id,marketplace,mode,json_extract(payload,'$.msku') AS msku,json_extract(payload,'$.rating') AS rating,json_extract(payload,'$.content') AS content,json_extract(payload,'$.timestamp') AS timestamp FROM events WHERE type='REVIEW';`);
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS exchange_rates(date TEXT,source TEXT,target TEXT,scope TEXT,rate_scaled INTEGER,as_of TEXT,provider TEXT,PRIMARY KEY(date,source,target,scope));
      CREATE TABLE IF NOT EXISTS conversions(event_id TEXT,type TEXT,marketplace TEXT,mode TEXT,rate_date TEXT,original_currency TEXT,original_amount INTEGER,base_currency TEXT,base_amount INTEGER,rate_scaled INTEGER,rate_time TEXT,PRIMARY KEY(event_id,type,marketplace,mode,base_currency,rate_date));`);
  }
  get(key, fallback) {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  set(key, value) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value!=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  saveStores(provider, stores) {
    const updated = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      const statement = this.db.prepare(`INSERT INTO stores(provider,id,name,marketplace_code,country_code,currency,enabled,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider,id) DO UPDATE SET name=excluded.name,marketplace_code=excluded.marketplace_code,country_code=excluded.country_code,currency=excluded.currency,enabled=excluded.enabled,updated_at=excluded.updated_at`);
      for (const store of stores || []) statement.run(provider, store.id, store.name, store.marketplaceCode, store.countryCode || null, store.currency || null, store.enabled === false ? 0 : 1, updated);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.listStores(provider);
  }
  listStores(provider) {
    return this.db.prepare("SELECT provider,id,name,marketplace_code AS marketplaceCode,country_code AS countryCode,currency,enabled,updated_at AS updatedAt FROM stores WHERE provider=? ORDER BY name").all(provider).map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
  }
  saveSalesSnapshot(provider, snapshot, rawHash = null) {
    this.db.prepare("INSERT INTO sales_snapshots(provider,business_date,base_currency,total,source,fetched_at,raw_hash) VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider,business_date,base_currency) DO UPDATE SET total=excluded.total,source=excluded.source,fetched_at=excluded.fetched_at,raw_hash=excluded.raw_hash").run(provider, snapshot.businessDate, snapshot.baseCurrency, snapshot.total, snapshot.source, snapshot.fetchedAt, rawHash);
  }
  latestSalesSnapshot(provider, baseCurrency) {
    return this.db.prepare("SELECT provider,business_date AS businessDate,base_currency AS baseCurrency,total,source,fetched_at AS fetchedAt,raw_hash AS rawHash FROM sales_snapshots WHERE provider=? AND base_currency=? ORDER BY business_date DESC LIMIT 1").get(provider, baseCurrency) || null;
  }
  clearSalesSnapshots(provider, baseCurrency = null) {
    if (baseCurrency) this.db.prepare("DELETE FROM sales_snapshots WHERE provider=? AND base_currency=?").run(provider, baseCurrency);
    else this.db.prepare("DELETE FROM sales_snapshots WHERE provider=?").run(provider);
  }
  syncState(provider, resourceType, storeId = "*") {
    return this.db.prepare("SELECT provider,resource_type AS resourceType,store_id AS storeId,cursor,last_success_at AS lastSuccessAt,last_attempt_at AS lastAttemptAt,last_error AS lastError FROM sync_state WHERE provider=? AND resource_type=? AND store_id=?").get(provider, resourceType, storeId) || null;
  }
  saveSyncState(provider, resourceType, storeId = "*", values = {}) {
    this.db.prepare("INSERT INTO sync_state(provider,resource_type,store_id,cursor,last_success_at,last_attempt_at,last_error) VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider,resource_type,store_id) DO UPDATE SET cursor=excluded.cursor,last_success_at=excluded.last_success_at,last_attempt_at=excluded.last_attempt_at,last_error=excluded.last_error").run(provider, resourceType, storeId, values.cursor ?? null, values.lastSuccessAt ?? null, values.lastAttemptAt ?? null, values.lastError ?? null);
  }
  ingest(events, mode, baseline = false) {
    const fresh = [];
    this.db.exec("BEGIN");
    try {
      for (const raw of events) {
        const e = {
          ...validate(raw),
          currency: raw.currency || MARKETPLACES[raw.marketplace].currency,
          _day: day(raw.timestamp, MARKETPLACES[raw.marketplace].zone),
        };
        const previous = this.db
          .prepare(
            "SELECT payload FROM events WHERE id=? AND type=? AND marketplace=? AND mode=?",
          )
          .get(e.id, e.type, e.marketplace, mode);
        if (!previous) {
          this.db
            .prepare(
              "INSERT INTO events(id,type,marketplace,mode,payload,displayed) VALUES(?,?,?,?,?,?)",
            )
            .run(
              e.id,
              e.type,
              e.marketplace,
              mode,
              JSON.stringify(e),
              baseline ? 1 : 0,
            );
          if (!baseline) fresh.push(e);
        } else if (e.type === "ORDER") {
          this.db
            .prepare(
              "UPDATE events SET payload=? WHERE id=? AND type=? AND marketplace=? AND mode=?",
            )
            .run(JSON.stringify(e), e.id, e.type, e.marketplace, mode);
        }
      }
      this.db.exec("COMMIT");
      return fresh;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
  total(marketplace, mode, now = Date.now()) {
    const date = day(now, MARKETPLACES[marketplace].zone);
    const { gross, refund } = this.db
      .prepare(
        `SELECT
      COALESCE(SUM(CASE WHEN type='ORDER' AND COALESCE(json_extract(payload,'$.status'),'')!='Canceled' THEN json_extract(payload,'$.amount') ELSE 0 END),0) AS gross,
      COALESCE(SUM(CASE WHEN type='REFUND' THEN json_extract(payload,'$.amount') ELSE 0 END),0) AS refund
      FROM events WHERE marketplace=? AND mode=? AND json_extract(payload,'$._day')=?`,
      )
      .get(marketplace, mode, date);
    this.db
      .prepare(
        "INSERT INTO daily_summary VALUES(?,?,?,?,?,?) ON CONFLICT(date,marketplace,mode) DO UPDATE SET gross_sales=excluded.gross_sales,refund_amount=excluded.refund_amount,sales=excluded.sales WHERE gross_sales!=excluded.gross_sales OR refund_amount!=excluded.refund_amount",
      )
      .run(date, marketplace, mode, gross, refund, gross - refund);
    return gross - refund;
  }
  mark(events, mode) {
    for (const e of events)
      for (const id of e.ids || [e.id])
        this.db
          .prepare(
            "UPDATE events SET displayed=1 WHERE id=? AND type=? AND marketplace=? AND mode=?",
          )
          .run(id, e.type, e.marketplace, mode);
  }
  rate(date, source, target, scope) {
    if (source === target)
      return { rate_scaled: SCALE, as_of: date, provider: "identity" };
    return this.db
      .prepare(
        "SELECT * FROM exchange_rates WHERE date=? AND source=? AND target=? AND scope=?",
      )
      .get(date, source, target, scope);
  }
  saveRate({ date, source, target, scope, rateScaled, asOf, provider }) {
    if (!Number.isSafeInteger(rateScaled) || rateScaled <= 0)
      throw Error("Invalid fixed exchange rate");
    this.db
      .prepare(`
        INSERT INTO exchange_rates(date, source, target, scope, rate_scaled, as_of, provider)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(date, source, target, scope) DO UPDATE SET
          rate_scaled=excluded.rate_scaled,
          as_of=excluded.as_of,
          provider=excluded.provider
      `)
      .run(date, source, target, scope, rateScaled, asOf, provider);
    return this.rate(date, source, target, scope);
  }
  converted(event, base, mode) {
    const currency = event.currency || MARKETPLACES[event.marketplace].currency;
    const date = day(event.timestamp, MARKETPLACES[event.marketplace].zone);
    const rate = this.rate(
      date,
      currency,
      base,
      mode === "demo-latest" ? "demo" : "live",
    );
    if (!rate) return null;
    const baseAmount = convertMinor(
      event.amount || 0,
      currency,
      base,
      rate.rate_scaled,
    );
    if (event.type !== "REVIEW")
      this.db
        .prepare(
          "INSERT INTO conversions VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id,type,marketplace,mode,base_currency,rate_date) DO UPDATE SET original_amount=excluded.original_amount,base_amount=excluded.base_amount,rate_scaled=excluded.rate_scaled,rate_time=excluded.rate_time WHERE original_amount!=excluded.original_amount OR rate_scaled!=excluded.rate_scaled",
        )
        .run(
          event.id,
          event.type,
          event.marketplace,
          mode,
          date,
          currency,
          event.amount,
          base,
          baseAmount,
          rate.rate_scaled,
          rate.as_of,
        );
    return {
      ...event,
      currency,
      baseCurrency: base,
      baseAmount,
      rate: rate.rate_scaled / SCALE,
      rateTimestamp: rate.as_of,
    };
  }
  aggregate(markets, base, mode, now = Date.now(), storeIds = []) {
    let result = 0;
    const missing = [];
    const rows = [];
    const selectedStores = [...new Set((storeIds || []).map(String))];
    const storeFilter = selectedStores.length
      ? ` AND json_extract(payload,'$.storeId') IN (${selectedStores.map(() => "?").join(",")})`
      : "";
    for (const market of markets) {
      const date = day(now, MARKETPLACES[market].zone);
      this.total(market, mode, now);
      for (const row of this.db
        .prepare(
          `SELECT payload FROM events WHERE marketplace=? AND mode=? AND json_extract(payload,'$._day')=? AND type!='REVIEW'${storeFilter}`,
        )
        .all(market, mode, date, ...selectedStores)) {
        const event = JSON.parse(row.payload);
        if (event.status === "Canceled") continue;
        const converted = this.converted(event, base, mode);
        if (!converted) {
          missing.push(
            `${date}:${event.currency || MARKETPLACES[market].currency}/${base}`,
          );
          continue;
        }
        result += (event.type === "REFUND" ? -1 : 1) * converted.baseAmount;
        rows.push(converted);
      }
    }
    const key = `aggregate:${mode}:${base}:${[...markets].sort().join(",")}`;
    if (missing.length)
      return {
        total: this.get(key, null),
        complete: false,
        missing: [...new Set(missing)],
        rows: [],
      };
    this.set(key, result);
    return { total: result, complete: true, missing: [], rows };
  }
  cancelOrder(orderId, marketplace, mode) {
    for (const row of this.db
      .prepare(
        "SELECT id,payload FROM events WHERE type='ORDER' AND marketplace=? AND mode=? AND json_extract(payload,'$.orderId')=?",
      )
      .all(marketplace, mode, orderId)) {
      const event = JSON.parse(row.payload);
      if (event.orderId === orderId) {
        event.status = "Canceled";
        this.db
          .prepare(
            "UPDATE events SET payload=? WHERE id=? AND type='ORDER' AND marketplace=? AND mode=?",
          )
          .run(JSON.stringify(event), row.id, marketplace, mode);
      }
    }
  }
  close() {
    this.db.close();
  }
}
module.exports = { Store };
