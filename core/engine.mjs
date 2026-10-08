const MARKETPLACES = {
  CA: {
    id: "A2EUQ1WTGCTBG2",
    name: "Canada",
    currency: "CAD",
    zone: "America/Los_Angeles",
    region: "na",
  },
  MX: {
    id: "A1AM78C64UM0Y8",
    name: "Mexico",
    currency: "MXN",
    zone: "America/Mexico_City",
    region: "na",
  },
  US: {
    id: "ATVPDKIKX0DER",
    name: "United States",
    currency: "USD",
    zone: "America/Los_Angeles",
    region: "na",
  },
  UK: {
    id: "A1F83G8C2ARO7P",
    name: "United Kingdom",
    currency: "GBP",
    zone: "Europe/London",
    region: "eu",
  },
  DE: {
    id: "A1PA6795UKMFR9",
    name: "Germany",
    currency: "EUR",
    zone: "Europe/Berlin",
    region: "eu",
  },
  FR: {
    id: "A13V1IB3VIYZZH",
    name: "France",
    currency: "EUR",
    zone: "Europe/Paris",
    region: "eu",
  },
  AU: {
    id: "A39IBJ37TRP1C6",
    name: "Australia",
    currency: "AUD",
    zone: "Australia/Sydney",
    region: "fe",
  },
  JP: {
    id: "A1VC38T7YXB528",
    name: "Japan",
    currency: "JPY",
    zone: "Asia/Tokyo",
    region: "fe",
  },
};
const dateFormatters = new Map();
function day(timestamp, zone) {
  if (!dateFormatters.has(zone))
    dateFormatters.set(
      zone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    );
  return dateFormatters.get(zone).format(new Date(timestamp));
}
function priority(e) {
  return e.type === "REFUND"
    ? 0
    : e.type === "REVIEW"
      ? e.rating <= 2
        ? 1
        : e.rating === 3
          ? 2
          : 4
      : 3;
}
function group(events, style) {
  let first = events[0];
  const entityIds = [
    ...new Set(
      events.flatMap(
        (e) => e.entityIds || [e.transactionId || e.orderId || e.id],
      ),
    ),
  ];
  return {
    ...first,
    ids: events.flatMap((e) => e.ids || [e.id]),
    entityIds,
    count: entityIds.length,
    quantity: events.reduce((s, e) => s + (e.quantity || 0), 0),
    amount: events.reduce((s, e) => s + (e.amount || 0), 0),
    baseAmount: events.reduce((s, e) => s + (e.baseAmount || 0), 0),
    salesDelta: events.reduce((s, e) => s + (e.salesDelta || 0), 0),
    negativeCount: events.reduce(
      (s, e) =>
        s + (e.negativeCount ?? (e.type === "REVIEW" && e.rating <= 2 ? 1 : 0)),
      0,
    ),
    mskus: [...new Set(events.flatMap((e) => e.mskus || [e.msku]))],
    rating: Math.min(...events.map((e) => e.rating || 5)),
    maxRating: Math.max(...events.map((e) => e.maxRating || e.rating || 5)),
    style,
  };
}
function merge(events, high = {}) {
  const out = [];
  for (const type of ["ORDER", "REFUND", "REVIEW"]) {
    const keys = [
      ...new Set(
        events
          .filter((e) => e.type === type)
          .map(
            (e) =>
              `${e.marketplace}|${e.currency || MARKETPLACES[e.marketplace]?.currency}`,
          ),
      ),
    ];
    for (const key of keys) {
      const list = events.filter(
        (e) =>
          e.type === type &&
          `${e.marketplace}|${e.currency || MARKETPLACES[e.marketplace]?.currency}` ===
            key,
      );
      if (!list.length) continue;
      if (type === "REVIEW") {
        list.sort(
          (a, b) =>
            priority(a) - priority(b) || a.timestamp.localeCompare(b.timestamp),
        );
        if (list.length < 3) out.push(...list.map((e) => group([e], "single")));
        else if (list[0].rating <= 2)
          out.push(group([list[0]], "single"), group(list.slice(1), "summary"));
        else out.push(group(list, "summary"));
      } else if (high[type]) out.push(group(list, "batch"));
      else if (new Set(list.map((e) => e.msku)).size > 1 && list.length >= 3)
        out.push(group(list, type === "REFUND" ? "batch" : "summary"));
      else {
        const by = new Map();
        for (const e of list) {
          if (!by.has(e.msku)) by.set(e.msku, []);
          by.get(e.msku).push(e);
        }
        out.push(...[...by.values()].map((es) => group(es, "single")));
      }
    }
  }
  return out.sort(
    (a, b) =>
      priority(a) - priority(b) || a.timestamp.localeCompare(b.timestamp),
  );
}
function compress(queue) {
  let result = [...queue];
  while (result.length > 5) {
    const counts = {};
    const bucket = (e) =>
      `${e.type}|${e.marketplace}|${e.currency || MARKETPLACES[e.marketplace]?.currency}`;
    for (const e of result) counts[bucket(e)] = (counts[bucket(e)] || 0) + 1;
    const type = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (counts[type] < 2) break;
    const indices = result
      .map((e, i) => (bucket(e) === type ? i : -1))
      .filter((i) => i >= 0)
      .slice(-2);
    const combined = group(
      indices.map((i) => result[i]),
      "more",
    );
    result = result.filter((_, i) => !indices.includes(i));
    result.push(combined);
  }
  return result.sort(
    (a, b) =>
      priority(a) - priority(b) || a.timestamp.localeCompare(b.timestamp),
  );
}
function validate(e) {
  if (
    !e ||
    !["ORDER", "REFUND", "REVIEW"].includes(e.type) ||
    typeof e.id !== "string" ||
    !e.id ||
    !MARKETPLACES[e.marketplace] ||
    !Number.isFinite(Date.parse(e.timestamp)) ||
    typeof e.msku !== "string" ||
    !e.msku
  )
    throw Error("Invalid event");
  if (e.currency && e.currency !== MARKETPLACES[e.marketplace].currency)
    throw Error("Currency does not match marketplace");
  if (e.type === "REVIEW") {
    if (
      !Number.isInteger(e.rating) ||
      e.rating < 1 ||
      e.rating > 5 ||
      typeof e.content !== "string"
    )
      throw Error("Invalid review");
  } else if (
    !Number.isSafeInteger(e.amount) ||
    e.amount < 0 ||
    !Number.isInteger(e.quantity) ||
    e.quantity < 1
  )
    throw Error("Invalid money or quantity");
  return e;
}
export { MARKETPLACES, day, priority, group, merge, compress, validate };
