const endpoints = require("./endpoints.cjs");
const { minorAmount } = require("./models.cjs");
const { formatDate } = require("./orders.cjs");

function mapRefunds(payload, storesByMarketId, selectedStoreIds = null) {
  const events = [];
  for (const row of payload?.data?.rows || []) {
    if (selectedStoreIds?.size && !selectedStoreIds.has(String(row.marketId))) continue;
    const store = storesByMarketId.get(String(row.marketId));
    const marketplace = store?.marketplaceCode;
    const currency = String(row.marketAmount?.currencyCode || row.currency || "").toUpperCase();
    const amount = row.marketAmount?.currencyAmount ?? row.price;
    const timestamp = row.settlementTimeMarket || row.settlementTime || row.purchaseDate;
    if (!marketplace || !row.orderId || !row.msku || !currency || !Number.isFinite(Number(amount)) || !timestamp) continue;
    // The official refund list is an itemized refund/fee feed and does not
    // expose a quantity field; each documented row is therefore one event.
    events.push({
      id: `refund:${row.orderId}:${row.msku}:${row.typeDetail || "amount"}:${timestamp}`,
      type: "REFUND",
      storeId: String(row.marketId),
      refundId: `${row.orderId}:${row.msku}:${timestamp}`,
      orderId: String(row.orderId),
      marketplace,
      msku: String(row.msku),
      quantity: 1,
      amount: Math.abs(minorAmount(Math.abs(Number(amount)), currency)),
      currency,
      timestamp: new Date(timestamp.replace(" ", "T") + (timestamp.endsWith("Z") ? "" : "Z")).toISOString(),
    });
  }
  return events;
}

async function getRefundsSince(client, storesByMarketId, cursor, storeIds = []) {
  const now = new Date();
  const after = cursor ? new Date(cursor) : new Date(now.getTime() - 172800000);
  const events = [];
  let page = 1;
  while (true) {
    const payload = await client.request(endpoints.refunds, {
      method: "POST",
      body: { dateType: 2, startDate: formatDate(after).slice(0, 10), endDate: formatDate(now).slice(0, 10), page, pagesize: 100 },
    });
    events.push(...mapRefunds(payload, storesByMarketId, storeIds.length ? new Set(storeIds.map(String)) : null));
    const data = payload?.data || {};
    if (!data.rows?.length || page * Number(data.pagesize || 100) >= Number(data.total || events.length)) break;
    page++;
  }
  return { events, cursor: now.toISOString() };
}

module.exports = { getRefundsSince, mapRefunds };
