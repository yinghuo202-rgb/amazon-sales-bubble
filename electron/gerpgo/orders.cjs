const endpoints = require("./endpoints.cjs");
const { minorAmount } = require("./models.cjs");

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function marketplaceFor(order, storesByMarketId) {
  const store = storesByMarketId.get(String(order.marketId));
  return store?.marketplaceCode || String(order.addressCountrycode || "").toUpperCase();
}

function mapOrders(payload, storesByMarketId, selectedStoreIds = null) {
  const events = [];
  for (const order of payload?.data?.rows || []) {
    if (selectedStoreIds?.size && !selectedStoreIds.has(String(order.marketId))) continue;
    const marketplace = marketplaceFor(order, storesByMarketId);
    if (!marketplace) continue;
    const timestamp = order.updateDate || order.lastUpdateDate || order.purchaseDate;
    for (const item of order.itemVos || []) {
      const money = item.itemPriceAmount || item.sellingPriceAmount;
      const currency = String(money?.currencyCode || order.currencyCode || "").toUpperCase();
      // Some GerpGo order rows leave itemPriceAmount empty and set itemPrice
      // to zero. sellingPrice is the actual line-item sale price in that shape.
      const amountValue = money?.currencyAmount
        ?? (Number.isFinite(Number(item.sellingPrice)) && Number(item.sellingPrice) > 0
          ? item.sellingPrice
          : item.itemPrice);
      const msku = item.sellerSku || item.sku;
      const quantity = Number(item.quantityOrdered);
      if (!order.orderId || !msku || !currency || !Number.isFinite(Number(amountValue)) || !Number.isInteger(quantity) || quantity < 1 || !timestamp) continue;
      events.push({
        id: `${order.orderId}:${item.itemId || item.id || msku}`,
        type: "ORDER",
        storeId: String(order.marketId),
        orderId: String(order.orderId),
        itemId: item.itemId || item.id ? String(item.itemId || item.id) : undefined,
        marketplace,
        msku: String(msku),
        quantity,
        amount: minorAmount(amountValue, currency) * quantity,
        currency,
        timestamp: new Date(timestamp.replace(" ", "T") + (timestamp.endsWith("Z") ? "" : "Z")).toISOString(),
        status: Number(order.orderStatus) === 4 ? "Canceled" : String(order.orderStatus ?? "Unknown"),
      });
    }
  }
  return events;
}

async function getOrdersSince(client, storesByMarketId, cursor, storeIds = []) {
  const now = new Date();
  const after = cursor ? new Date(cursor) : new Date(now.getTime() - 172800000);
  const events = [];
  let page = 1;
  while (true) {
    const payload = await client.request(endpoints.orders, {
      method: "POST",
      body: {
        page,
        pagesize: 200,
        lastUpdateStartDate: formatDate(after),
        lastUpdateEndDate: formatDate(now),
      },
    });
    events.push(...mapOrders(payload, storesByMarketId, storeIds.length ? new Set(storeIds.map(String)) : null));
    const data = payload?.data || {};
    if (!data.rows?.length || page * Number(data.pagesize || 200) >= Number(data.total || events.length)) break;
    page++;
  }
  return { events, cursor: now.toISOString() };
}

module.exports = { getOrdersSince, mapOrders, formatDate };
