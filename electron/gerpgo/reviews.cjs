const endpoints = require("./endpoints.cjs");
const { formatDate } = require("./orders.cjs");

function mapReviews(payload, storesByMarketId, selectedStoreIds = null) {
  const events = [];
  for (const row of payload?.data?.rows || []) {
    if (selectedStoreIds?.size && !selectedStoreIds.has(String(row.marketId))) continue;
    const store = storesByMarketId.get(String(row.marketId));
    const marketplace = store?.marketplaceCode;
    const rating = Number(row.star);
    const msku = row.product || row.asin;
    const timestamp = row.reviewDate || row.updateDate || row.createTime;
    if (!marketplace || !row.reviewId || !msku || !Number.isInteger(rating) || rating < 1 || rating > 5 || typeof row.content !== "string" || !timestamp) continue;
    events.push({
      id: `review:${row.reviewId}`,
      type: "REVIEW",
      storeId: String(row.marketId),
      marketplace,
      msku: String(msku),
      asin: row.asin ? String(row.asin) : undefined,
      rating,
      content: row.content,
      timestamp: new Date(timestamp.replace(" ", "T") + (timestamp.endsWith("Z") ? "" : "Z")).toISOString(),
    });
  }
  return events;
}

async function getReviewsSince(client, storesByMarketId, cursor, storeIds = []) {
  const now = new Date();
  const after = cursor ? new Date(cursor) : new Date(now.getTime() - 172800000);
  const events = [];
  let page = 1;
  while (true) {
    const payload = await client.request(endpoints.reviews, {
      method: "POST",
      body: { page, pagesize: 100, updateDateBegin: formatDate(after), updateDateEnd: formatDate(now) },
    });
    events.push(...mapReviews(payload, storesByMarketId, storeIds.length ? new Set(storeIds.map(String)) : null));
    const data = payload?.data || {};
    if (!data.rows?.length || page * Number(data.pagesize || 100) >= Number(data.total || events.length)) break;
    page++;
  }
  return { events, cursor: now.toISOString() };
}

module.exports = { getReviewsSince, mapReviews };
