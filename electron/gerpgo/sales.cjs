const endpoints = require("./endpoints.cjs");
const { minorAmount } = require("./models.cjs");
const { normalizeMarketplaceCode } = require("./models.cjs");

async function getTodaySales(client, { businessDate, baseCurrency, marketIds = [], storesByMarketId = new Map() }) {
  if (!businessDate || !baseCurrency) throw Error("GerpGo 店铺表现需要业务日期和本位币。");
  const rows = [];
  let page = 1;
  while (true) {
    const payload = await client.request(endpoints.sales, {
      method: "POST",
      body: {
        page,
        // The official endpoint caps this at 100 rows per page.
        pagesize: 100,
        ...(marketIds.length ? { marketList: marketIds } : {}),
        beginDate: businessDate,
        endDate: businessDate,
        showCurrencyType: baseCurrency,
      },
    });
    rows.push(...(Array.isArray(payload?.data?.rows) ? payload.data.rows : []));
    const data = payload?.data || {};
    if (!data.rows?.length || page * Number(data.pagesize || 100) >= Number(data.total || rows.length)) break;
    page++;
  }
  let total = 0;
  const markets = [];
  for (const row of rows) {
    const amount = row.orderProductSalesAmount;
    const currency = String(amount?.currencyCode || row.currency || baseCurrency).toUpperCase();
    const originalAmount = Number(amount?.currencyAmount ?? row.orderProductSales);
    if (!Number.isFinite(originalAmount)) continue;
    const baseAmount = minorAmount(originalAmount, currency);
    total += baseAmount;
    const storeId = row.marketId == null ? "" : String(row.marketId);
    markets.push({
      storeId,
      marketplaceCode: storesByMarketId.get(storeId)?.marketplaceCode || normalizeMarketplaceCode(row.countryName, row.marketName),
      currency,
      originalAmount: baseAmount,
      baseAmount,
    });
  }
  return {
    businessDate,
    baseCurrency: String(baseCurrency).toUpperCase(),
    total,
    markets,
    fetchedAt: new Date().toISOString(),
    source: "gerpgo-statistics",
  };
}

module.exports = { getTodaySales };
