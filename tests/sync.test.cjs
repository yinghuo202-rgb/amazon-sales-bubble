const { test } = require("node:test");
const assert = require("node:assert/strict");
const { GerpGoClient, requestSignature } = require("../electron/gerpgo/client.cjs");
const { GerpGoDataSource } = require("../electron/gerpgo/datasource.cjs");
const { mapOrders } = require("../electron/gerpgo/orders.cjs");
const { getTodaySales } = require("../electron/gerpgo/sales.cjs");
const { flattenStores } = require("../electron/gerpgo/stores.cjs");
const { Store } = require("../core/store.cjs");
const { config, normalizeBaseUrl, DEFAULT_BASE_URL } = require("../electron/gerpgo/config.cjs");
const { GerpGoPoller } = require("../electron/gerpgo/poller.cjs");

test("GerpGo client authenticates with the verified /api_token route and redacts token headers", async () => {
  const calls = [];
  const client = new GerpGoClient({
    baseUrl: "https://api.example.test",
    credentials: { officialKey: "secret" },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ accessToken: "token-1", expiresIn: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await client.authenticate();
  assert.equal(calls[0].url, "https://api.example.test/api_token");
  assert.equal(JSON.parse(calls[0].options.body).officialKey, "secret");
  assert.equal(client.hasUsableToken(), true);
});

test("GerpGo signs business requests with the exact JSON body and leaves token exchange unsigned", async () => {
  const calls = [];
  const credentials = { appId: "app", appKey: "key" };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    if (path === "/api_token") return new Response(JSON.stringify({ code: 200, data: { accessToken: "token-1", expiresIn: 3600 } }), { status: 200 });
    return new Response(JSON.stringify({ code: 200, data: { rows: [] } }), { status: 200 });
  };
  const client = new GerpGoClient({ baseUrl: "https://api.example.test", credentials, fetcher });
  await client.authenticate();
  assert.equal(calls[0].options.headers.sign, undefined);

  const body = { page: 1, pagesize: 100, condition: { marketId: 70 } };
  await client.request("/middle/base/market/page", { method: "POST", body });
  const serialized = JSON.stringify(body);
  assert.equal(calls[1].options.body, serialized);
  assert.equal(calls[1].options.headers.accessToken, "token-1");
  assert.equal(calls[1].options.headers.sign, requestSignature(serialized, credentials.appKey));

  await client.request("/middle/base/baseCurrency/query");
  assert.equal(calls[2].options.headers.sign, requestSignature("", credentials.appKey));
});

test("GerpGo defaults to the official docs proxy when no Host is supplied", () => {
  assert.equal(config().baseUrl, DEFAULT_BASE_URL);
  assert.equal(normalizeBaseUrl("https://open.gerpgo.com"), DEFAULT_BASE_URL);
  assert.equal(normalizeBaseUrl("https://open.gerpgo.com/api"), DEFAULT_BASE_URL);
});

test("GerpGo surfaces the server message for credential HTTP 400 responses", async () => {
  const client = new GerpGoClient({
    baseUrl: "https://open.gerpgo.com/api/open",
    credentials: { appId: "inactive", appKey: "bad" },
    fetcher: async () => new Response(JSON.stringify({ code: 40101, messages: ["获取token失败，appId未激活，请检查传参"] }), { status: 400 }),
  });
  await assert.rejects(() => client.authenticate(), /appId未激活/);
});

test("GerpGo datasource connects and detects documented capabilities", async () => {
  const fetcher = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/api_token") return new Response(JSON.stringify({ code: 200, data: { accessToken: "t", expiresIn: 3600 } }));
    if (path.endsWith("/market/page")) return new Response(JSON.stringify({ code: 200, data: { rows: [], total: 0, page: 1, pagesize: 100 } }));
    if (path.endsWith("/baseCurrency/query")) return new Response(JSON.stringify({ code: 200, data: "USD" }));
    if (path.endsWith("/rate/page")) return new Response(JSON.stringify({ code: 200, data: { rows: [], total: 0, page: 1, pagesize: 500 } }));
    return new Response(JSON.stringify({ code: 200, data: { rows: [], total: 0, page: 1, pagesize: 100 } }));
  };
  const client = new GerpGoClient({ baseUrl: "https://api.example.test", fetcher });
  const source = new GerpGoDataSource({ client });
  const result = await source.connect();
  assert.equal(result.provider, "gerpgo");
  assert.equal(result.capabilities.orders, true);
});

test("GerpGo exchange rates convert CNY quotes into the selected base currency", async () => {
  let body;
  const client = {
    request: async (_path, options) => {
      body = options.body;
      return { data: { rows: [
        { currency: "CNY", referenceRate: 1, customRate: 1, monthDate: "2026-09" },
        { currency: "USD", referenceRate: 6.78, customRate: 0, monthDate: "2026-09" },
        { currency: "CAD", referenceRate: 4.86, customRate: 0, monthDate: "2026-09" },
      ], total: 3, pagesize: 500 } };
    },
  };
  const source = new GerpGoDataSource({ client });
  const rates = await source.getExchangeRates({ baseCurrency: "USD" });
  assert.equal(body.condition.monthDate.length, 7);
  assert.equal(rates.find((rate) => rate.from === "USD").rate, 1);
    assert.equal(rates.find((rate) => rate.from === "CAD").rate, 4.86 / 6.78);
});

test("GerpGo groups sales requests by each marketplace local business date", () => {
  const source = new GerpGoDataSource({ client: { request: async () => ({}) }, storeIds: ["1", "2"] });
  source.stores = [
    { id: "1", marketplaceCode: "US", enabled: true },
    { id: "2", marketplaceCode: "CA", enabled: true },
  ];
  const groups = source.salesDateGroups(new Date("2026-09-30T05:00:00.000Z"));
  assert.deepEqual(groups, [{ businessDate: "2026-09-29", marketIds: [1, 2] }]);
});

test("GerpGo keeps order events when a secondary resource request fails", async () => {
  const seen = [];
  const statuses = [];
  const source = {
    capabilities: { orders: true, refunds: true, reviews: true },
    getOrdersSince: async () => ({ events: [{ id: "order-1" }], cursor: "orders-1" }),
    getRefundsSince: async () => ({ events: [], cursor: "refunds-1" }),
    getReviewsSince: async () => { throw Object.assign(new Error("review timeout"), { code: "TIMEOUT" }); },
    getTodaySales: async () => ({ businessDate: "2026-09-30", baseCurrency: "USD", total: 100, markets: [] }),
  };
  const poller = new GerpGoPoller({
    source,
    cursorStore: { get: () => null, set: () => {} },
    onEvents: async (events) => seen.push(...events),
    onSnapshot: async () => {},
    onStatus: (status) => statuses.push(status),
  });
  await poller.runOnce();
  poller.stop();
  assert.deepEqual(seen, [{ id: "order-1" }]);
  assert.equal(statuses.at(-1), "error");
});

test("Store persists provider stores and sync cursor state", () => {
  const db = new Store(":memory:");
  db.saveStores("gerpgo", [{ id: "store-1", name: "US", marketplaceCode: "US", currency: "USD", enabled: true }]);
  assert.equal(db.listStores("gerpgo")[0].marketplaceCode, "US");
  db.saveSyncState("gerpgo", "orders", "*", { cursor: "c1", lastSuccessAt: "2026-09-21T00:00:00Z" });
  assert.equal(db.syncState("gerpgo", "orders").cursor, "c1");
  db.close();
});

test("official order fields map to normalized event and omit buyer PII", () => {
  const stores = new Map([["70", { marketplaceCode: "US" }]]);
  const events = mapOrders({ data: { rows: [{ orderId: "o1", marketId: 70, orderStatus: 3, updateDate: "2026-09-21 10:00:00", currencyCode: "USD", buyerEmail: "private@example.test", itemVos: [{ itemId: "i1", sellerSku: "MA025", quantityOrdered: 2, itemPriceAmount: { currencyCode: "USD", currencyAmount: 39.99 } }] }] } }, stores);
  assert.equal(events[0].amount, 7998);
  assert.equal(events[0].quantity, 2);
  assert.equal("buyerEmail" in events[0], false);
});

test("order mapper uses sellingPrice when GerpGo leaves itemPriceAmount empty", () => {
  const events = mapOrders({ data: { rows: [{
    orderId: "o-selling-price",
    marketId: 70,
    orderStatus: 3,
    updateDate: "2026-09-21 10:00:00",
    currencyCode: "USD",
    itemVos: [{ itemId: "i-selling-price", sellerSku: "MA240", quantityOrdered: 2, itemPrice: 0, sellingPrice: 15.27, itemPriceAmount: null }],
  }] } }, new Map([["70", { marketplaceCode: "US" }]]));
  assert.equal(events[0].amount, 3054);
});

test("official store aliases normalize amazon-us and store performance paginates at the documented limit", async () => {
  const stores = flattenStores({ data: { rows: [{ marketListVos: [{ marketId: 70, market: "amazon-us", store: "US store", state: 0, marketState: 0, apiState: "Normal" }] }] } });
  assert.equal(stores[0].marketplaceCode, "US");
  let calls = 0;
  const client = { request: async (_path, options) => {
    calls++;
    assert.equal(options.body.pagesize, 100);
    return { data: { page: calls, pagesize: 100, total: 101, rows: calls === 1
      ? Array.from({ length: 100 }, (_, index) => ({ marketId: 70, countryName: "amazon-us", orderProductSalesAmount: { currencyCode: "USD", currencyAmount: 1 } }))
      : [{ marketId: 70, countryName: "amazon-us", orderProductSalesAmount: { currencyCode: "USD", currencyAmount: 2 } }] } };
  } };
  const snapshot = await getTodaySales(client, { businessDate: "2026-09-21", baseCurrency: "USD", marketIds: [70] });
  assert.equal(calls, 2);
  assert.equal(snapshot.total, 10200);
  assert.equal(snapshot.markets[0].marketplaceCode, "US");
});

test("GerpGo store selection is sent to sales and filters event feeds", async () => {
  let salesBody;
  const client = { request: async (_path, options) => {
    salesBody = options.body;
    return { data: { page: 1, pagesize: 100, total: 1, rows: [{ marketId: 4, countryName: "amazon-us", orderProductSalesAmount: { currencyCode: "USD", currencyAmount: 12.34 } }] } };
  } };
  const { getTodaySales: getSales } = require("../electron/gerpgo/sales.cjs");
  const snapshot = await getSales(client, { businessDate: "2026-09-28", baseCurrency: "USD", marketIds: [4] });
  assert.deepEqual(salesBody.marketList, [4]);
  assert.equal(snapshot.total, 1234);
  const events = mapOrders({ data: { rows: [
    { orderId: "selected", marketId: 4, orderStatus: 3, updateDate: "2026-09-28 10:00:00", currencyCode: "USD", itemVos: [{ itemId: "i1", sellerSku: "A", quantityOrdered: 1, itemPriceAmount: { currencyCode: "USD", currencyAmount: 1 } }] },
    { orderId: "other", marketId: 9, orderStatus: 3, updateDate: "2026-09-28 10:00:00", currencyCode: "USD", itemVos: [{ itemId: "i2", sellerSku: "B", quantityOrdered: 1, itemPriceAmount: { currencyCode: "USD", currencyAmount: 2 } }] },
  ] } }, new Map([["4", { marketplaceCode: "US" }], ["9", { marketplaceCode: "US" }]]), new Set(["4"]));
  assert.deepEqual(events.map((event) => event.orderId), ["selected"]);
});
