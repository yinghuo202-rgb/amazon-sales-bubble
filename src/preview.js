import { Presentation } from "../core/presentation.mjs";
import { MARKETPLACES, day } from "../core/engine.mjs";
import { convertMinor, demoRate, CURRENCIES } from "../core/currency.mjs";
export function createPreview() {
  const defaults = {
    orders: true,
    refunds: true,
    reviews: true,
    startup: false,
    markets: ["US", "CA", "MX"],
    baseCurrency: "USD",
    source: "demo",
    glass: 60,
    reducedMotion: false,
  };
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem("sales-bubble-latest") || "null");
  } catch {}
  const { displayMode: _legacyDisplayMode, ...savedPreferences } =
    saved?.preferences || {};
  let preferences = { ...defaults, ...savedPreferences, source: "demo" },
    events = saved?.events || [];
  const listeners = new Set();
  const persist = () =>
    localStorage.setItem(
      "sales-bubble-latest",
      JSON.stringify({ preferences, events }),
    );
  const seed = () => {
    const amounts = {
      US: 1081837,
      CA: 200000,
      MX: 400000,
      UK: 70000,
      DE: 80000,
      JP: 100000,
    };
    for (const m of preferences.markets) {
      const id = `baseline-${m}-${day(Date.now(), MARKETPLACES[m].zone)}`;
      if (!events.some((e) => e.id === id))
        events.push({
          id,
          type: "ORDER",
          marketplace: m,
          currency: MARKETPLACES[m].currency,
          msku: "BASELINE",
          quantity: 1,
          amount: amounts[m],
          timestamp: new Date().toISOString(),
        });
    }
  };
  const converted = (e) =>
    convertMinor(
      e.amount || 0,
      e.currency,
      preferences.baseCurrency,
      demoRate(e.currency, preferences.baseCurrency),
    );
  const total = () =>
    events
      .filter(
        (e) =>
          preferences.markets.includes(e.marketplace) &&
          day(e.timestamp, MARKETPLACES[e.marketplace].zone) ===
            day(Date.now(), MARKETPLACES[e.marketplace].zone),
      )
      .reduce(
        (sum, e) =>
          sum +
          (e.type === "REVIEW"
            ? 0
            : e.type === "REFUND"
              ? -converted(e)
              : converted(e)),
        0,
      );
  seed();
  const machine = new Presentation({
    total: total(),
    onChange: () => publish(),
  });
  const get = () => ({
    ...machine.snapshot(),
    settings: preferences,
    connection: "demo",
    desktop: false,
    material: "Browser preview",
    layoutStatus: "preview",
    lastSync: null,
    error: null,
    fxReady: true,
    fxMissing: [],
    hasKnownTotal: true,
  });
  const publish = () => listeners.forEach((fn) => fn(get()));
  return {
    get: async () => get(),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    settings: async (values) => {
      if (
        values.markets &&
        (!values.markets.length || values.markets.some((m) => !MARKETPLACES[m]))
      )
        throw Error("至少启用一个市场。");
      if (values.baseCurrency && !CURRENCIES.includes(values.baseCurrency))
        throw Error("未知基础币种。");
      preferences = { ...preferences, ...values, source: "demo" };
      seed();
      persist();
      if (values.markets || values.baseCurrency) machine.reset(total());
      publish();
      return get();
    },
    demo: async (request) => {
      const { type, marketplace: m } = request;
      if (!preferences.markets.includes(m)) throw Error("请选择已启用的市场。");
      const fresh = Array.from(
        { length: type === "BURST" ? 7 : type === "REVIEWS" ? 4 : 1 },
        (_, i) => {
          const kind =
            type === "BURST" ? "ORDER" : type === "REVIEWS" ? "REVIEW" : type;
          return {
            id: crypto.randomUUID(),
            type: kind,
            marketplace: m,
            currency: MARKETPLACES[m].currency,
            msku: i % 2 ? "MA356" : "MA025",
            quantity: kind === "REFUND" || m === "CA" ? 1 : 2,
            amount: m === "CA" ? 6000 : kind === "REFUND" ? 3999 : 7998,
            timestamp: new Date().toISOString(),
            rating: type === "REVIEWS" ? (i < 2 ? 2 : 5) : 2,
            content: "Gauge stopped working after a week.",
          };
        },
      );
      events.push(...fresh);
      persist();
      machine.ingest(
        fresh
          .map((e) => ({
            ...e,
            baseCurrency: preferences.baseCurrency,
            baseAmount: converted(e),
            salesDelta:
              e.type === "REVIEW"
                ? 0
                : (e.type === "REFUND" ? -1 : 1) * converted(e),
            silent:
              !preferences[
                { ORDER: "orders", REFUND: "refunds", REVIEW: "reviews" }[
                  e.type
                ]
              ],
          }))
          .filter((e) => e.type !== "REVIEW" || !e.silent),
        total(),
      );
      return get();
    },
    reconnect: async () => get(),
    connect: async () => {
      throw Error("请在 Windows 桌面版中连接 Amazon。");
    },
    openSettings: () => {},
    quick: () => {},
    context: () => {},
    hide: () => {},
    exit: () => {},
    ready: () => {},
    reportError: () => {},
  };
}
