const endpoints = require("./endpoints.cjs");
const { normalizeStore, normalizeMarketplaceCode } = require("./models.cjs");
const { MARKETPLACES } = require("../../core/engine.cjs");

function rowsOf(payload) {
  return Array.isArray(payload?.data?.rows) ? payload.data.rows : [];
}

function flattenStores(payload) {
  const stores = [];
  for (const account of rowsOf(payload)) {
    for (const market of account.marketListVos || []) {
      const marketplaceCode = normalizeMarketplaceCode(market.market, market.countryCode);
      if (!market.marketId || !marketplaceCode) continue;
      stores.push(normalizeStore({
        id: market.marketId,
        name: market.store || market.marketName || marketplaceCode,
        marketplaceCode,
        countryCode: market.countryCode,
        currency: market.currency || MARKETPLACES[marketplaceCode]?.currency || undefined,
        enabled: market.state === 0 && market.marketState !== 1 && market.apiState !== "Invalid",
      }));
    }
  }
  return stores;
}

async function getStores(client) {
  const out = [];
  let page = 1;
  while (true) {
    const payload = await client.request(endpoints.stores, { method: "POST", body: { page, pagesize: 100, condition: {} } });
    const rows = flattenStores(payload);
    out.push(...rows);
    const data = payload?.data || {};
    if (!rows.length || page * Number(data.pagesize || 100) >= Number(data.total || out.length)) break;
    page++;
  }
  return [...new Map(out.map((store) => [store.id, store])).values()];
}

module.exports = { getStores, flattenStores };
