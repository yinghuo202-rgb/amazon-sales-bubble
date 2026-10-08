const { CommerceDataSource, UnsupportedCapabilityError } = require("../../core/data-source.cjs");
const { GerpGoAuth } = require("./auth.cjs");
const { capabilities } = require("./models.cjs");
const endpoints = require("./endpoints.cjs");
const storesApi = require("./stores.cjs");
const salesApi = require("./sales.cjs");
const ordersApi = require("./orders.cjs");
const refundsApi = require("./refunds.cjs");
const reviewsApi = require("./reviews.cjs");
const { MARKETPLACES, day } = require("../../core/engine.cjs");

class GerpGoDataSource extends CommerceDataSource {
  constructor({ client, auth = new GerpGoAuth(client), logger, storeIds = [] } = {}) {
    super();
    if (!client) throw Error("GerpGoDataSource requires a GerpGoClient");
    this.client = client;
    this.auth = auth;
    this.logger = logger;
    this.storeIds = Array.isArray(storeIds) ? storeIds.map(String) : [];
    this.capabilities = capabilities();
    this.stores = [];
    this.storesByMarketId = new Map();
    this.baseCurrency = null;
  }

  async connect() {
    const auth = await this.auth.connect();
    this.stores = await storesApi.getStores(this.client);
    this.storesByMarketId = new Map(this.stores.map((store) => [String(store.id), store]));
    const baseCurrency = await this.getBaseCurrency();
    this.baseCurrency = baseCurrency;
    const exchangeRates = await this.getExchangeRates({ baseCurrency });
    this.capabilities = capabilities({ stores: true, sales: true, orders: true, refunds: true, reviews: true, exchangeRates: true });
    return { ...auth, provider: "gerpgo", stores: this.stores, baseCurrency, exchangeRates, capabilities: { ...this.capabilities } };
  }

  unsupported(capability) { throw new UnsupportedCapabilityError(capability); }
  async getStores() {
    this.stores = await storesApi.getStores(this.client);
    this.storesByMarketId = new Map(this.stores.map((store) => [String(store.id), store]));
    return this.stores;
  }
  async getBaseCurrency() {
    const payload = await this.client.request(endpoints.baseCurrency);
    const value = payload?.data;
    if (typeof value !== "string" || !value) throw Error("GerpGo 本位币响应字段无效。");
    return value.toUpperCase();
  }
  salesDateGroups(timestamp = new Date()) {
    const selected = this.storeIds.length
      ? this.stores.filter((store) => this.storeIds.includes(String(store.id)))
      : this.stores.filter((store) => store.enabled !== false);
    const groups = new Map();
    for (const store of selected) {
      const code = String(store.marketplaceCode || "").toUpperCase();
      const zone = MARKETPLACES[code]?.zone;
      if (!zone || !Number.isInteger(Number(store.id))) continue;
      const businessDate = day(timestamp, zone);
      if (!groups.has(businessDate)) groups.set(businessDate, []);
      groups.get(businessDate).push(Number(store.id));
    }
    return [...groups.entries()].map(([businessDate, marketIds]) => ({
      businessDate,
      marketIds: [...new Set(marketIds)],
    }));
  }
  async getExchangeRates({ baseCurrency } = {}) {
    const rows = [];
    let page = 1;
    const monthDate = new Date().toISOString().slice(0, 7);
    while (true) {
      const payload = await this.client.request(endpoints.exchangeRates, { method: "POST", body: { page, pagesize: 500, condition: { monthDate } } });
      rows.push(...(payload?.data?.rows || []));
      const data = payload?.data || {};
      if (!data.rows?.length || page * Number(data.pagesize || 500) >= Number(data.total || rows.length)) break;
      page++;
    }
    // GerpGo's rate table is quoted against CNY (CNY=1). Convert the quote
    // ratio into the requested base currency before it reaches the shared FX
    // store: each value is CNY per source, so source->base = sourceQuote / baseQuote.
    const quotes = new Map();
    for (const row of rows) {
      const currency = String(row.currency || "").toUpperCase();
      const quote = Number(row.customRate || row.referenceRate);
      if (currency && Number.isFinite(quote) && quote > 0 && !quotes.has(currency)) quotes.set(currency, { quote, monthDate: row.monthDate });
    }
    const target = String(baseCurrency || "").toUpperCase();
    const targetQuote = quotes.get(target)?.quote;
    if (!targetQuote) return [];
    const out = [];
    for (const [from, value] of quotes) {
      out.push({
        from,
        to: target,
        rate: from === target ? 1 : value.quote / targetQuote,
        effectiveDate: value.monthDate ? `${value.monthDate}-01` : undefined,
      });
    }
    return out;
  }
  async getTodaySales(options = {}) {
    return salesApi.getTodaySales(this.client, {
      ...options,
      baseCurrency: options.baseCurrency || this.baseCurrency,
      marketIds: options.marketIds || (this.storeIds.length
        ? this.storeIds.map(Number).filter(Number.isInteger)
        : this.stores.filter((store) => store.enabled !== false).map((store) => Number(store.id)).filter(Number.isInteger)),
      storesByMarketId: this.storesByMarketId,
    });
  }
  async getOrdersSince(cursor) { return ordersApi.getOrdersSince(this.client, this.storesByMarketId, cursor, this.storeIds); }
  async getRefundsSince(cursor) { return refundsApi.getRefundsSince(this.client, this.storesByMarketId, cursor, this.storeIds); }
  async getReviewsSince(cursor) { return reviewsApi.getReviewsSince(this.client, this.storesByMarketId, cursor, this.storeIds); }
}

module.exports = { GerpGoDataSource };
