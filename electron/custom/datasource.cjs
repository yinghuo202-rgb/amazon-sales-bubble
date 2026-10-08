const { CommerceDataSource, UnsupportedCapabilityError } = require("../../core/data-source.cjs");
const { MARKETPLACES } = require("../../core/engine.cjs");
const { normalizeMarketplaceCode, capabilities } = require("../gerpgo/models.cjs");
const { GenericRestClient } = require("./client.cjs");

const DEFAULT_PATHS = Object.freeze({
  stores: { path: "/stores", method: "GET" },
  baseCurrency: { path: "/base-currency", method: "GET" },
  exchangeRates: { path: "/exchange-rates", method: "GET" },
  sales: { path: "/sales/today", method: "GET" },
  orders: { path: "/orders", method: "GET" },
  refunds: { path: "/refunds", method: "GET" },
  reviews: { path: "/reviews", method: "GET" },
});

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  return [];
}

function value(payload, keys, fallback = undefined) {
  const source = payload?.data && !Array.isArray(payload.data) ? payload.data : payload;
  for (const key of keys) if (source?.[key] !== undefined && source?.[key] !== null) return source[key];
  return fallback;
}

function currency(value, fallback = "USD") {
  const code = String(value || fallback || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

function minorAmount(input, code) {
  if (input === null || input === undefined || input === "") throw Error("ERP 金额字段为空");
  const numeric = Number(input);
  if (!Number.isFinite(numeric)) throw Error("ERP 金额字段无效");
  const digits = code === "JPY" ? 0 : 2;
  const result = Math.round(numeric * 10 ** digits);
  if (!Number.isSafeInteger(result)) throw Error("ERP 金额超出安全范围");
  return result;
}

function endpoint(config, name) {
  const item = config?.paths?.[name] ?? DEFAULT_PATHS[name];
  if (!item) return null;
  if (typeof item === "string") return { path: item, method: "GET" };
  return { method: String(item.method || "GET").toUpperCase(), path: String(item.path || "") };
}

class GenericRestDataSource extends CommerceDataSource {
  constructor({ config = {}, client, storeIds = [] } = {}) {
    super();
    this.config = config;
    this.client = client || new GenericRestClient(config);
    this.storeIds = Array.isArray(storeIds) ? storeIds.map(String) : [];
    this.provider = "custom";
    this.capabilities = capabilities({
      stores: Boolean(endpoint(config, "stores")),
      sales: Boolean(endpoint(config, "sales")),
      orders: Boolean(endpoint(config, "orders")),
      refunds: Boolean(endpoint(config, "refunds")),
      reviews: Boolean(endpoint(config, "reviews")),
      exchangeRates: Boolean(endpoint(config, "exchangeRates")),
    });
    this.stores = [];
    this.storesById = new Map();
    this.baseCurrency = currency(config.baseCurrency, "USD");
  }

  async call(name, { query = {}, body } = {}) {
    const item = endpoint(this.config, name);
    if (!item) throw new UnsupportedCapabilityError(name, `当前 ERP 未提供 ${name} 接口。`);
    return this.client.request(item.path, item.method === "GET" ? { method: item.method, query } : { method: item.method, body: body || query });
  }

  async connect() {
    this.stores = await this.getStores();
    this.storesById = new Map(this.stores.map((store) => [String(store.id), store]));
    try { this.baseCurrency = currency(await this.getBaseCurrency(), this.baseCurrency); } catch (error) { if (error.code !== "UNSUPPORTED_CAPABILITY") throw error; }
    let exchangeRates = [];
    if (this.capabilities.exchangeRates) exchangeRates = await this.getExchangeRates({ baseCurrency: this.baseCurrency });
    return { connected: true, provider: this.provider, stores: this.stores, baseCurrency: this.baseCurrency, exchangeRates, capabilities: { ...this.capabilities } };
  }

  async getStores() {
    const list = rows(await this.call("stores"));
    return list.map((row, index) => {
      const code = normalizeMarketplaceCode(value(row, ["marketplaceCode", "marketplace", "countryCode", "country"], "US"));
      const id = value(row, ["id", "storeId", "marketId"], index + 1);
      return { id: String(id), name: String(value(row, ["name", "storeName", "shopName"], `Store ${id}`)), marketplaceCode: code, countryCode: String(value(row, ["countryCode", "country"], code)), currency: currency(value(row, ["currency", "currencyCode"]), MARKETPLACES[code]?.currency || "USD"), enabled: value(row, ["enabled", "active", "status"], true) !== false };
    });
  }

  async getBaseCurrency() {
    const payload = await this.call("baseCurrency");
    return currency(value(payload, ["baseCurrency", "currency", "currencyCode"], this.baseCurrency), this.baseCurrency);
  }

  async getExchangeRates({ baseCurrency: target } = {}) {
    return rows(await this.call("exchangeRates", { query: { baseCurrency: target } })).map((row) => ({
      from: currency(value(row, ["from", "source", "sourceCurrency", "currency"])),
      to: currency(value(row, ["to", "target", "targetCurrency"], target), target),
      rate: Number(value(row, ["rate", "exchangeRate", "value"])),
      effectiveDate: value(row, ["effectiveDate", "date", "asOf"]),
    })).filter((row) => row.from && row.to && Number.isFinite(row.rate) && row.rate > 0);
  }

  salesDateGroups() { return [{ businessDate: new Date().toISOString().slice(0, 10), storeIds: this.storeIds }]; }

  async getTodaySales(options = {}) {
    const payload = await this.call("sales", { query: { businessDate: options.businessDate, storeIds: options.storeIds || this.storeIds, baseCurrency: options.baseCurrency || this.baseCurrency } });
    const total = value(payload, ["total", "sales", "salesAmount", "totalSales", "amount"], 0);
    const base = currency(value(payload, ["baseCurrency", "currency", "currencyCode"], options.baseCurrency || this.baseCurrency), this.baseCurrency);
    return { total: Number.isSafeInteger(Number(total)) ? Number(total) : minorAmount(total, base), baseCurrency: base, businessDate: options.businessDate || new Date().toISOString().slice(0, 10), markets: [] };
  }

  store(row) { return this.storesById.get(String(value(row, ["storeId", "marketId", "shopId"]))) || null; }
  event(row, type) {
    const store = this.store(row);
    const marketplace = normalizeMarketplaceCode(value(row, ["marketplaceCode", "marketplace", "countryCode", "country"], store?.marketplaceCode || "US"));
    const code = currency(value(row, ["currency", "currencyCode"]), store?.currency || MARKETPLACES[marketplace]?.currency || "USD");
    const rawAmount = value(row, ["amountMinor", "minorAmount"]);
    const amount = rawAmount !== undefined ? Number(rawAmount) : minorAmount(value(row, ["amount", "total", "salesAmount", "refundAmount", "sellingPrice", "itemPrice"], 0), code);
    return { id: String(value(row, ["id", "orderId", "refundId", "reviewId"], `${type}-${Date.now()}-${Math.random()}`)), type, timestamp: String(value(row, ["timestamp", "updatedAt", "updateDate", "createdAt", "date"], new Date().toISOString())), marketplace, currency: code, msku: String(value(row, ["msku", "sku", "sellerSku", "productSku"], "ERP")), quantity: Number(value(row, ["quantity", "quantityOrdered", "qty"], 1)) || 1, amount, rating: Number(value(row, ["rating", "star", "stars"], 0)) || 0, content: String(value(row, ["content", "review", "comment"], "")), status: String(value(row, ["status", "orderStatus"], "")) };
  }

  async events(name, type, cursor) {
    const payload = await this.call(name, { query: { cursor, updatedAfter: cursor } });
    return { events: rows(payload).map((row) => this.event(row, type)), cursor: value(payload, ["nextCursor", "cursor", "next"] , cursor) };
  }
  async getOrdersSince(cursor) { return this.events("orders", "ORDER", cursor); }
  async getRefundsSince(cursor) { return this.events("refunds", "REFUND", cursor); }
  async getReviewsSince(cursor) { return this.events("reviews", "REVIEW", cursor); }
}

module.exports = { GenericRestDataSource, DEFAULT_PATHS, rows, minorAmount };
