const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  screen,
  safeStorage,
  clipboard,
  powerMonitor,
} = require("electron");
const path = require("node:path"),
  fs = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");
const { Store } = require("../core/store.cjs");
const { MARKETPLACES, day } = require("../core/engine.cjs");
const { CURRENCIES } = require("../core/currency.mjs");
const { Presentation } = require("../core/presentation.mjs");
const { panelPosition } = require("../core/layout.cjs");
const { widgetSize, floatingLayout } = require("../core/widget-layout.cjs");
const native = require("./windows.cjs");
const { GerpGoClient } = require("./gerpgo/client.cjs");
const { GerpGoDataSource } = require("./gerpgo/datasource.cjs");
const { GerpGoPoller } = require("./gerpgo/poller.cjs");
const { GenericRestClient } = require("./custom/client.cjs");
const { GenericRestDataSource } = require("./custom/datasource.cjs");
const { DEFAULT_BASE_URL, normalizeBaseUrl } = require("./gerpgo/config.cjs");
const { ExchangeRates } = require("./fx.cjs");
const defaults = {
  orders: true,
  refunds: true,
  reviews: true,
  startup: false,
  markets: ["US", "CA", "MX"],
  // Empty means all currently enabled provider stores. Once the user chooses
  // specific stores this contains their stable marketId values.
  storeIds: [],
  baseCurrency: "USD",
  source: "demo",
  glass: 60,
  reducedMotion: false,
  alwaysOnTop: true,
  floatingPosition: null,
};
let db,
  fx,
  widget,
  panel,
  settingsWindow,
  tray,
  machine,
  preferences = { ...defaults },
  hidden = false,
  widgetReady = false,
  quitting = false,
  error = null,
  fxError = null,
  commerceSource = null,
  commercePoller = null,
  capabilities = {
    stores: false,
    sales: false,
    orders: false,
    refunds: false,
    reviews: false,
    exchangeRates: false,
  },
  lastSync = null,
  material = "initializing",
  layoutStatus = "initializing",
  generation = 0,
  surfaceRevision = 0,
  geometryTimer,
  dateTimer,
  retryTimer,
  dateKey = "",
  lastGeometry = "",
  dragOffset = null,
  dragging = false,
  deferred = [],
  valuation = { total: 0, complete: true, missing: [] },
  publicIp = { status: "idle", value: "", error: "", checkedAt: null };
const workers = new Map(),
  statuses = new Map();
let reconnectQueue = Promise.resolve();
const LIVE_SOURCES = new Set(["gerpgo", "custom"]);
const isLiveSource = (source = preferences.source) => LIVE_SOURCES.has(source);
const providerKey = (source = preferences.source) => isLiveSource(source) ? source : "gerpgo";
const providerName = (source = preferences.source) => source === "custom" ? "自定义 ERP" : "GerpGo";
app.setName("amazon-vision");
if (process.argv.includes("--software-rendering"))
  app.disableHardwareAcceleration();
function log(event, details = "") {
  try {
    fs.appendFileSync(
      path.join(app.getPath("userData"), "diagnostics-latest.log"),
      `${new Date().toISOString()} ${event} ${String(details).slice(0, 1200)}\n`,
    );
  } catch {}
}
function namespace() {
  return preferences.source === "demo"
    ? "demo-latest"
    : `${providerKey()}:` + db.get(`${providerKey()}AccountKey`, "unconfigured");
}
function dates() {
  return preferences.markets
    .map((m) => day(Date.now(), MARKETPLACES[m].zone))
    .join("|");
}
function status() {
  if (preferences.source === "demo") return "demo";
  const current = statuses.get(providerKey()) || "disconnected";
  return current;
}
function state() {
  return {
    ...machine.snapshot(),
    settings: preferences,
    stores: db?.listStores?.(providerKey()) || [],
    provider: providerKey(),
    providerName: providerName(),
    connection: status(),
    syncStatuses: Object.fromEntries(statuses),
    lastSync,
    error: error || fxError,
    fxReady: valuation.complete,
    fxMissing: valuation.missing,
    hasKnownTotal: valuation.total !== null,
    desktop: true,
    material,
    surfaceRevision,
    layoutStatus,
    capabilities,
    publicIp,
  };
}
function normalizePublicIp(value) {
  const candidate = String(value || "").trim().replace(/^\"|\"$/g, "");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(candidate)) {
    const valid = candidate.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
    return valid ? candidate : "";
  }
  return "";
}
async function detectPublicIp() {
  publicIp = { ...publicIp, status: "checking", error: "" };
  broadcast();
  const endpoints = [
    async () => (await (await fetch("https://api4.ipify.org?format=json", { signal: AbortSignal.timeout(5000) })).json())?.ip,
    async () => await (await fetch("https://ipv4.icanhazip.com", { signal: AbortSignal.timeout(5000) })).text(),
    async () => await (await fetch("https://ifconfig.me/ip", { signal: AbortSignal.timeout(5000) })).text(),
  ];
  for (const request of endpoints) {
    try {
      const value = normalizePublicIp(await request());
      if (!value) continue;
      publicIp = { status: "ready", value, error: "", checkedAt: new Date().toISOString() };
      broadcast();
      return publicIp;
    } catch {}
  }
  publicIp = { status: "error", value: "", error: "未检测到公网 IPv4，请检查网络或联系网络管理员。", checkedAt: new Date().toISOString() };
  broadcast();
  return publicIp;
}
function broadcast() {
  if (!machine || quitting) return;
  position();
  const snapshot = state();
  for (const w of [widget, panel, settingsWindow])
    if (w && !w.isDestroyed()) w.webContents.send("state", snapshot);
}
function createWindow(view, options) {
  const w = new BrowserWindow({
    ...options,
    webPreferences: {
      preload: path.join(__dirname, "preload-v2.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  w.setMenuBarVisibility(false);
  w.on("page-title-updated", (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.webContents.on("did-fail-load", (_, code, message) =>
    log("load-failed", `${view} ${code} ${message}`),
  );
  w.webContents.on("console-message", (_, details) => {
    if (details.level === "error" || details.level === 3)
      log("renderer-error", `${view} ${details.message}`);
  });
  w.webContents.on("render-process-gone", (_, details) =>
    log("renderer-gone", `${view} ${details.reason}`),
  );
  w.loadFile(path.join(__dirname, "../dist/index.html"), {
    query: { view },
  }).catch((e) => log("load-error", e.message));
  return w;
}
function layout() {
  const size = widgetSize();
  const saved = preferences.floatingPosition;
  const display = saved
    ? screen.getDisplayNearestPoint(saved)
    : screen.getPrimaryDisplay();
  layoutStatus = "floating";
  return floatingLayout({ work: display.workArea, size, saved });
}
function position() {
  if (!widgetReady || dragging) return;
  const p = layout(),
    key = JSON.stringify(p);
  if (key === lastGeometry) return;
  lastGeometry = key;
  const { visible, status, ...bounds } = p;
  widget.setBounds(bounds);
  log(
    "widget-position",
    JSON.stringify({ bounds: widget.getBounds(), visible }),
  );
  try {
    native.round(widget, bounds.width, bounds.height, bounds.height);
  } catch (e) {
    log("clip-fallback", e.message);
  }
  if (!hidden && visible) widget.showInactive();
  else {
    widget.hide();
  }
  // Composition and window-region changes invalidate the first Chromium surface.
  // Request one repaint on layout changes; never poll the renderer for frames.
  widget.webContents.invalidate();
  setTimeout(() => {
    if (quitting || widget.isDestroyed()) return;
    surfaceRevision++;
    broadcast();
  }, 120);
}
function glass() {
  // Native Acrylic applies to the whole BrowserWindow. On a fixed transparent
  // host that creates the rectangular color block outside the capsule, so the
  // floating-only build keeps the host transparent and lets the inner pill
  // own the CSS glass surface.
  material = "CSS glass";
}
function openSettings() {
  panel?.close();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = createWindow("settings", {
    width: 980,
    height: 700,
    minWidth: 780,
    minHeight: 560,
    backgroundColor: "#0a2149",
    show: false,
    title: "Amazon Sales Bubble · 设置",
  });
  settingsWindow.once("ready-to-show", () => settingsWindow?.show());
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}
function quick() {
  if (panel && !panel.isDestroyed()) {
    panel.close();
    return;
  }
  const b = widget.getBounds(),
    a = screen.getDisplayMatching(b).workArea;
  panel = createWindow("quick", {
    ...panelPosition(b, a, 292, 234),
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
  });
  panel.once("ready-to-show", () => panel?.show());
  panel.on("blur", () => panel?.close());
  panel.on("closed", () => {
    panel = null;
  });
}
function setHidden(value) {
  hidden = value;
  lastGeometry = "";
  position();
  if (hidden) {
    panel?.close();
  }
  trayMenu();
  broadcast();
}
function menuItems() {
  return [
    { label: "Settings", click: openSettings },
    { label: "Reconnect data source", click: () => reconnect() },
    { label: hidden ? "Show" : "Hide", click: () => setHidden(!hidden) },
    { type: "separator" },
    { label: "Exit", click: () => app.quit() },
  ];
}
function trayMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate(menuItems()));
}
function seed() {
  if (preferences.source !== "demo") return;
  const amounts = {
    US: 1081837,
    CA: 200000,
    MX: 400000,
    UK: 70000,
    DE: 80000,
    JP: 100000,
  };
  db.ingest(
    preferences.markets.map((m) => ({
      id: "baseline-latest-" + day(Date.now(), MARKETPLACES[m].zone),
      type: "ORDER",
      timestamp: new Date().toISOString(),
      marketplace: m,
      currency: MARKETPLACES[m].currency,
      msku: "BASELINE",
      quantity: 1,
      amount: amounts[m],
      status: "Unshipped",
    })),
    namespace(),
    true,
  );
  fx.demo(preferences.markets, preferences.baseCurrency);
}
function aggregate() {
  if (isLiveSource()) {
    const cached = db.latestSalesSnapshot(providerKey(), preferences.baseCurrency);
    if (cached) {
      valuation = { total: cached.total, complete: true, missing: [], rows: [] };
      return valuation.total;
    }
  }
  valuation = db.aggregate(
    preferences.markets,
    preferences.baseCurrency,
    namespace(),
    Date.now(),
    isLiveSource() ? preferences.storeIds : [],
  );
  return valuation.total ?? machine?.total ?? 0;
}
function stopSync() {
  generation++;
  for (const worker of workers.values()) worker.stop();
  commercePoller?.stop();
  commercePoller = null;
  commerceSource = null;
  workers.clear();
  statuses.clear();
  deferred = [];
  clearTimeout(retryTimer);
}
let reconcileChain = Promise.resolve();
function reconcile(fresh = [], epoch = generation) {
  const result = reconcileChain.then(() => reconcileOnce(fresh, epoch));
  reconcileChain = result.catch(() => {});
  return result;
}
async function reconcileOnce(fresh = [], epoch = generation) {
  if (epoch !== generation || quitting) return;
  deferred.push(...fresh);
  try {
    if (!isLiveSource()) {
      await fx.ensure(
        preferences.markets,
        preferences.baseCurrency,
        preferences.source,
        deferred,
      );
    }
    if (epoch !== generation || quitting) return;
    fxError = null;
    clearTimeout(retryTimer);
    const next = aggregate();
    if (!valuation.complete) throw Error("部分汇率缺失，保留最后有效总额。");
    const visual = deferred
      .map((e) => {
        const converted =
          e.type === "REVIEW"
            ? e
            : db.converted(e, preferences.baseCurrency, namespace());
        const current =
          day(e.timestamp, MARKETPLACES[e.marketplace].zone) ===
          day(Date.now(), MARKETPLACES[e.marketplace].zone);
        return {
          ...(converted || e),
          salesDelta: current && e.status !== "Canceled"
            ? e.type === "ORDER"
              ? converted?.baseAmount || 0
              : e.type === "REFUND"
                ? -(converted?.baseAmount || 0)
                : 0
            : 0,
          silent:
            !preferences[
              { ORDER: "orders", REFUND: "refunds", REVIEW: "reviews" }[e.type]
            ],
        };
      })
      .filter((e) => e.type !== "REVIEW" || !e.silent);
    deferred = [];
    // Provider sales snapshots are reconciled periodically. Apply
    // newly received current-day events immediately so the total advances
    // with the order bubble instead of waiting for the next snapshot.
    const liveNext = isLiveSource()
      ? next + visual.reduce((sum, event) => sum + (event.salesDelta || 0), 0)
      : next;
    machine.ingest(visual, liveNext);
  } catch (e) {
    if (epoch !== generation || quitting) return;
    aggregate();
    fxError = e.message;
    broadcast();
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => reconcile([], epoch), 60000);
    retryTimer.unref();
  }
}
function ingest(events, baseline = false, epoch = generation) {
  const result = reconcileChain.then(async () => {
    if (epoch !== generation || quitting) return;
    const fresh = db.ingest(events, namespace(), baseline);
    await reconcileOnce(fresh, epoch);
  });
  reconcileChain = result.catch(() => {});
  return result;
}
async function updateSettings(value) {
  const next = {};
  for (const key of [
    "orders",
    "refunds",
    "reviews",
    "startup",
    "reducedMotion",
  ])
    if (typeof value[key] === "boolean") next[key] = value[key];
  if (typeof value.alwaysOnTop === "boolean")
    next.alwaysOnTop = value.alwaysOnTop;
  if (["demo", "gerpgo", "custom"].includes(value.source)) next.source = value.source;
  if (CURRENCIES.includes(value.baseCurrency))
    next.baseCurrency = value.baseCurrency;
  if (Array.isArray(value.markets)) {
    if (!value.markets.length || value.markets.some((m) => !MARKETPLACES[m]))
      throw Error("至少启用一个有效市场。");
    next.markets = [...new Set(value.markets)];
  }
  if (Array.isArray(value.storeIds)) {
    const available = new Set((db?.listStores?.(providerKey(value.source || preferences.source)) || []).map((store) => String(store.id)));
    const selected = [...new Set(value.storeIds.map(String))].filter((id) => available.has(id));
    if (!selected.length) throw Error("至少选择一个店铺。");
    next.storeIds = selected;
  }
  if (Number.isFinite(value.glass))
    next.glass = Math.min(100, Math.max(30, value.glass));
  const changed =
    ("source" in next && next.source !== preferences.source) ||
    ("baseCurrency" in next &&
      next.baseCurrency !== preferences.baseCurrency) ||
    ("markets" in next &&
      JSON.stringify(next.markets) !== JSON.stringify(preferences.markets)) ||
    ("storeIds" in next && JSON.stringify(next.storeIds) !== JSON.stringify(preferences.storeIds));
  if (changed) stopSync();
  preferences = { ...preferences, ...next };
  if (changed && ("storeIds" in next || "source" in next || "baseCurrency" in next))
    db.clearSalesSnapshots(providerKey(preferences.source));
  db.set("preferences-latest", preferences);
  if ("startup" in next)
    app.setLoginItemSettings({
      openAtLogin: preferences.startup,
      path: process.env.PORTABLE_EXECUTABLE_FILE || app.getPath("exe"),
    });
  if (changed) {
    error = null;
    fxError = null;
    lastSync = null;
    seed();
    machine.reset(aggregate());
    dateKey = dates();
    await reconcile();
    if (isLiveSource()) reconnect();
  }
  if ("alwaysOnTop" in next)
    widget?.setAlwaysOnTop(preferences.alwaysOnTop, "pop-up-menu");
  broadcast();
  return state();
}
async function demo(request) {
  if (preferences.source !== "demo") throw Error("真实账户禁止注入演示数据。");
  const type = typeof request === "string" ? request : request.type;
  const market =
    typeof request === "string" ? preferences.markets[0] : request.marketplace;
  if (
    !preferences.markets.includes(market) ||
    !["ORDER", "REFUND", "REVIEW", "BURST", "REVIEWS"].includes(type)
  )
    throw Error("无效的演示事件。");
  const events = Array.from(
    { length: type === "BURST" ? 7 : type === "REVIEWS" ? 4 : 1 },
    (_, i) => ({
      id: randomUUID(),
      type: type === "BURST" ? "ORDER" : type === "REVIEWS" ? "REVIEW" : type,
      timestamp: new Date().toISOString(),
      marketplace: market,
      currency: MARKETPLACES[market].currency,
      msku: i % 2 ? "MA356" : "MA025",
      quantity: type === "REFUND" ? 1 : 2,
      amount: market === "CA" ? 6000 : type === "REFUND" ? 3999 : 7998,
      rating: type === "REVIEWS" ? (i < 2 ? 2 : 5) : 2,
      content: "Gauge stopped working after a week.",
      status: "Unshipped",
    }),
  );
  await ingest(events);
  return state();
}
async function reconnectImpl() {
  stopSync();
  error = null;
  if (preferences.source === "demo") {
    capabilities = { stores: false, sales: false, orders: false, refunds: false, reviews: false, exchangeRates: false };
    broadcast();
    return state();
  }
  const sourceName = preferences.source;
  const key = providerKey(sourceName);
  const encrypted = db.get(`${key}Credentials`, null);
  if (!encrypted) {
    error = `请先在账户设置中连接${providerName(sourceName)}。`;
    broadcast();
    return state();
  }
  let credentials;
  try {
    if (!safeStorage.isEncryptionAvailable()) throw Error();
    credentials = JSON.parse(
      safeStorage.decryptString(Buffer.from(encrypted, "base64")),
    );
  } catch {
    error = "无法读取系统加密凭证，请重新连接。";
    broadcast();
    return state();
  }
  const epoch = generation;
  try {
    let source;
    if (sourceName === "gerpgo") {
      const client = new GerpGoClient({ credentials, baseUrl: normalizeBaseUrl(db.get("gerpgoBaseUrl", process.env.GERPGO_BASE_URL || DEFAULT_BASE_URL)) });
      client.setLogger((event, details) => log(`gerpgo-${event}`, JSON.stringify(details)));
      source = new GerpGoDataSource({ client, storeIds: preferences.storeIds });
    } else if (sourceName === "custom") {
      const client = new GenericRestClient(credentials);
      source = new GenericRestDataSource({ config: credentials, client, storeIds: preferences.storeIds });
    } else {
      throw Error("未知数据源。");
    }
    commerceSource = source;
    statuses.set(key, "syncing");
    const connected = await source.connect();
    // A newer connect request may have replaced this attempt while the
    // provider was still responding. Never let the stale attempt overwrite
    // the new connection state or start a second poller.
    if (epoch !== generation || quitting) return state();
    capabilities = connected.capabilities;
    db.saveStores(key, connected.stores || []);
    const availableStoreIds = new Set((connected.stores || []).filter((store) => store.enabled !== false).map((store) => String(store.id)));
    if (preferences.storeIds.length) {
      preferences.storeIds = preferences.storeIds.filter((id) => availableStoreIds.has(String(id)));
      if (!preferences.storeIds.length) preferences.storeIds = [...availableStoreIds];
      db.set("preferences-latest", preferences);
      source.storeIds = preferences.storeIds;
    }
    if (connected.baseCurrency && CURRENCIES.includes(connected.baseCurrency)) {
      preferences.baseCurrency = connected.baseCurrency;
    }
    const enabledMarkets = [...new Set((connected.stores || [])
      .map((store) => store.marketplaceCode)
      .filter((market) => MARKETPLACES[market]))];
    if (enabledMarkets.length) preferences.markets = enabledMarkets;
    db.set("preferences-latest", preferences);
    const rateDates = [0, 1, 2].map((days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10));
    fx.applyProvider(connected.exchangeRates || [], "live", rateDates, providerName(sourceName));
    commercePoller = new GerpGoPoller({
      source,
      cursorStore: {
        get: (key, fallback) => db.get(`sync:${key}`, fallback),
        set: (key, value) => db.set(`sync:${key}`, value),
      },
      onEvents: (events, baseline) => ingest(events, baseline, epoch),
      onSnapshot: async (snapshot) => {
        if (!snapshot) return;
        db.saveSalesSnapshot(key, snapshot);
        if (snapshot.baseCurrency === preferences.baseCurrency) {
          machine.reset(snapshot.total);
          valuation = { total: snapshot.total, complete: true, missing: [] };
        }
        broadcast();
      },
      onStatus: (value, message) => {
        if (epoch !== generation) return;
        statuses.set(key, value);
        if (message) error = message;
        if (value === "connected") lastSync = new Date().toISOString();
        broadcast();
      },
    });
    commercePoller.start();
  } catch (e) {
    if (epoch !== generation || quitting) return state();
    statuses.set(key, "error");
    error = e.message;
    broadcast();
  }
  broadcast();
  return state();
}
// Startup reconnect, resume reconnect, and an explicit account connect can
// otherwise overlap. The official proxy treats overlapping account requests
// as a transient 509, so serialize them and let the newest generation win.
function reconnect() {
  const next = reconnectQueue.catch(() => {}).then(() => reconnectImpl());
  reconnectQueue = next.catch(() => {});
  return next;
}
async function tick() {
  if (quitting) return;
  const next = dates();
  if (next !== dateKey) {
    dateKey = next;
    deferred = [];
    machine.reset(aggregate());
  }
  await reconcile();
}
function icon() {
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const p = (y * 16 + x) * 4;
      pixels[p] = 180;
      pixels[p + 1] = 155;
      pixels[p + 2] = 119;
      pixels[p + 3] = (x - 7.5) ** 2 + (y - 7.5) ** 2 < 54 ? 255 : 0;
      if (
        (x === 5 && y >= 7 && y <= 10) ||
        (x === 8 && y >= 4 && y <= 10) ||
        (x === 11 && y >= 6 && y <= 10)
      )
        pixels[p] = pixels[p + 1] = pixels[p + 2] = 245;
    }
  return nativeImage.createFromBitmap(pixels, { width: 16, height: 16 });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (db) {
      setHidden(false);
      openSettings();
    }
  });
  app
    .whenReady()
    .then(() => {
      log("startup", `version=${app.getVersion()} packaged=${app.isPackaged}`);
      db = new Store(path.join(app.getPath("userData"), "vision.sqlite"));
      fx = new ExchangeRates(db);
      const savedPreferences = db.get("preferences-latest", {}) || {};
      const { displayMode: _legacyDisplayMode, ...saved } = savedPreferences;
      preferences = { ...defaults, ...saved };
      if (!Array.isArray(preferences.storeIds)) preferences.storeIds = [];
      if (!['demo', 'gerpgo', 'custom'].includes(preferences.source)) preferences.source = "gerpgo";
      db.set("preferences-latest", preferences);
      seed();
      dateKey = dates();
      machine = new Presentation({
        total: aggregate(),
        onChange: broadcast,
        onDisplay: (e) => db.mark([e], namespace()),
      });
      const initialPlacement = layout();
      widget = createWindow("widget", {
        x: initialPlacement.x,
        y: initialPlacement.y,
        width: initialPlacement.width,
        height: initialPlacement.height,
        frame: false,
        thickFrame: false,
        roundedCorners: false,
        transparent: true,
        backgroundColor: "#00000000",
        resizable: false,
        alwaysOnTop: preferences.alwaysOnTop,
        skipTaskbar: true,
        focusable: false,
        show: false,
        hasShadow: false,
        title: "Amazon Sales Bubble · Sales",
      });
      widget.setAlwaysOnTop(preferences.alwaysOnTop, "pop-up-menu");
      widget.setSkipTaskbar(true);
      widget.setIgnoreMouseEvents(false);
      widget.setFocusable(true);
      widget.on("moved", () => {
        if (!widgetReady) return;
        if (dragging) {
          lastGeometry = "";
          return;
        }
        const b = widget.getBounds();
        const expected = lastGeometry ? JSON.parse(lastGeometry) : null;
        if (expected && b.x === expected.x && b.y === expected.y) return;
        preferences.floatingPosition = { x: b.x, y: b.y };
        db.set("preferences-latest", preferences);
        lastGeometry = "";
      });
      widget.once("ready-to-show", () => {
        widgetReady = true;
        native.round(
          widget,
          initialPlacement.width,
          initialPlacement.height,
          initialPlacement.height,
        );
        glass();
        position();
        broadcast();
        log("widget-ready", material);
      });
      tray = new Tray(icon());
      tray.setToolTip("Amazon Sales Bubble");
      tray.on("click", quick);
      tray.on("double-click", openSettings);
      trayMenu();
      screen.on("display-metrics-changed", () => {
        lastGeometry = "";
        position();
      });
      screen.on("display-removed", () => {
        lastGeometry = "";
        position();
      });
      powerMonitor.on("resume", () => {
        position();
        tick();
        if (isLiveSource()) reconnect();
      });
      geometryTimer = setInterval(position, 3000);
      geometryTimer.unref();
      dateTimer = setInterval(tick, 60000);
      dateTimer.unref();
      if (isLiveSource()) reconnect();
      detectPublicIp();
      if (
        !db.get("onboarded-latest", false) ||
        process.argv.includes("--settings")
      ) {
        openSettings();
        db.set("onboarded-latest", true);
      }
    })
    .catch((e) => {
      log("startup-failed", e.stack);
      app.quit();
    });
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => {
    quitting = true;
    stopSync();
    machine?.dispose();
    clearInterval(geometryTimer);
    clearInterval(dateTimer);
    db?.close();
  });
}
ipcMain.handle("state", () => state());
ipcMain.handle("settings", (_, v) => updateSettings(v || {}));
ipcMain.handle("demo", (_, v) => demo(v));
ipcMain.handle("reconnect", reconnect);
ipcMain.handle("public-ip", detectPublicIp);
ipcMain.handle("copy-text", (_, value) => {
  if (typeof value !== "string" || !value) return false;
  clipboard.writeText(value.slice(0, 256));
  return true;
});
ipcMain.handle("open-settings", openSettings);
ipcMain.handle("quick-panel", quick);
ipcMain.handle("context-menu", () => {
  // Menu.popup returns an Electron-owned object/promise that cannot cross the
  // contextBridge serializer. The renderer only needs an acknowledgement.
  Menu.buildFromTemplate(menuItems()).popup({ window: widget });
  return true;
});
ipcMain.on("drag-start", () => {
  if (!widgetReady || !widget) return;
  const cursor = screen.getCursorScreenPoint(),
    bounds = widget.getBounds();
  dragOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  dragging = true;
  widget.setFocusable(true);
});
ipcMain.on("drag-move", () => {
  if (!dragOffset || !widget || widget.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint(),
    bounds = widget.getBounds(),
    work = screen.getDisplayNearestPoint(cursor).workArea,
    x = Math.max(
      work.x,
      Math.min(cursor.x - dragOffset.x, work.x + work.width - bounds.width),
    ),
    y = Math.max(
      work.y,
      Math.min(cursor.y - dragOffset.y, work.y + work.height - bounds.height),
    );
  widget.setPosition(Math.round(x), Math.round(y), false);
});
ipcMain.on("drag-end", () => {
  dragOffset = null;
  dragging = false;
  if (!widget || widget.isDestroyed()) return;
  const b = widget.getBounds();
  preferences.floatingPosition = { x: b.x, y: b.y };
  db?.set("preferences-latest", preferences);
  lastGeometry = "";
  widget.setFocusable(true);
});
ipcMain.handle("hide", () => setHidden(true));
ipcMain.handle("exit", () => app.quit());
ipcMain.on("renderer-ready", (event, value) => {
  log("renderer-ready", JSON.stringify(value));
  event.sender.send("state", state());
});
ipcMain.on("renderer-error", (_, message) => log("renderer-error", message));
ipcMain.handle("connect", async (_, c) => {
  if (!c || typeof c !== "object") throw Error("连接参数无效。");
  const source = c.provider === "custom" ? "custom" : "gerpgo";
  let credentials;
  if (source === "gerpgo") {
    if (typeof c.appId !== "string" || typeof c.appKey !== "string" || !c.appId.trim() || !c.appKey.trim())
      throw Error("请填写 GerpGo 官方 App ID 和 App Key。");
    credentials = { appId: c.appId.trim(), appKey: c.appKey.trim() };
  } else {
    if (typeof c.token !== "string" || !c.token.trim()) throw Error("请填写 ERP API Token。");
    credentials = {
      baseUrl: String(c.baseUrl || "").trim().replace(/\/$/, ""),
      token: c.token.trim(),
      tokenHeader: typeof c.tokenHeader === "string" ? c.tokenHeader.trim() || "Authorization" : "Authorization",
      tokenPrefix: typeof c.tokenPrefix === "string" ? c.tokenPrefix : "Bearer ",
      baseCurrency: typeof c.baseCurrency === "string" ? c.baseCurrency.trim().toUpperCase() : "USD",
    };
  }
  if (Object.values(credentials).some((value) => typeof value === "string" && value.length >= 4096)) throw Error("凭证或 API 地址过长。");
  const baseUrl = source === "gerpgo" ? normalizeBaseUrl(c.baseUrl) : credentials.baseUrl;
  if (!/^https?:\/\//i.test(baseUrl)) throw Error("API 地址无效。");
  if (!safeStorage.isEncryptionAvailable())
    throw Error("Windows 安全存储不可用。");
  stopSync();
  // Snapshots are scoped to the account and selected stores. Clear the old
  // scope before a new account or store selection can be displayed.
  db.clearSalesSnapshots(source);
  db.set(
    `${source}Credentials`,
    safeStorage
      .encryptString(JSON.stringify(credentials))
      .toString("base64"),
  );
  db.set(
    `${source}AccountKey`,
    createHash("sha256")
      .update(JSON.stringify(credentials))
      .digest("hex")
      .slice(0, 24),
  );
  if (source === "gerpgo") db.set("gerpgoBaseUrl", baseUrl);
  preferences.source = source;
  db.set("preferences-latest", preferences);
  machine.reset(aggregate());
  return reconnect();
});
