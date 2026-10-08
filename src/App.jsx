import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  ArrowUpRight,
  ArrowDownLeft,
  Check,
  ChevronRight,
  Monitor,
  SlidersHorizontal,
  Bell,
  Plug,
  ShieldCheck,
  Star,
  Layers,
  Settings,
  Power,
  X,
  RefreshCw,
  Info,
  ArrowRight,
  Sparkles,
  Globe,
  Coins,
  GripVertical,
} from "lucide-react";
import { createPreview } from "./preview";
import { Phase } from "../core/presentation.mjs";
import { MARKETPLACES } from "../core/engine.mjs";
import { CURRENCIES, digits } from "../core/currency.mjs";
import "./app.css";
import "./unified.css";
const api = window.vision || createPreview();
const view = new URLSearchParams(location.search).get("view") || "settings";
document.documentElement.dataset.view = view;
window.addEventListener("error", (e) => api.reportError(e.message));
window.addEventListener("unhandledrejection", (e) =>
  api.reportError(String(e.reason)),
);
export const money = (amount, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amount / 10 ** digits(currency),
  );
function salesAmount(amount, currency = "USD") {
  const value = amount / 10 ** digits(currency);
  if (Math.abs(value) >= 1_000_000)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  return money(amount, currency);
}
function SalesPill({ state, onClick, onContext, native = false }) {
  const dragMoved = useRef(false);
  const event = state.active && !state.active.silent ? state.active : null;
  const showingEvent = !!event && state.content === "event";
  // The rebuilt product has one presentation: a draggable floating capsule.
  const moving = state.phase !== Phase.IDLE,
    up = state.phase === Phase.UP;
  const authError =
    !showingEvent &&
    !!state.error &&
    /gerpgo|授权|凭证|401|403|unauthoriz|permission/i.test(state.error);
  const floatingState = showingEvent
    ? `floating-${event.type.toLowerCase()}`
    : "floating-idle";
  const pillGeometry = showingEvent
    ? event.type === "REVIEW"
      ? { width: 320, height: 72, borderRadius: 32 }
      : { width: 286, height: 64, borderRadius: 30 }
    : { width: 220, height: 56, borderRadius: 28 };
  const pillTransition = state.settings.reducedMotion
    ? { duration: 0.01 }
    : { type: "spring", stiffness: 340, damping: 28, mass: 0.8 };
  // The floating capsule owns the visible glass surface. Keep the setting on
  // that surface itself so the slider affects both the desktop widget and the
  // in-app preview instead of the legacy inner button style.
  const glassOpacity = 0.48 + state.settings.glass * 0.004;
  const value = state.hasKnownTotal
    ? salesAmount(state.displayTotal, state.settings.baseCurrency)
    : "—";
  const displayValue = authError ? "Reconnect GerpGo" : value;
  function updateLensPointer(e) {
    const surface = e.currentTarget;
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    surface.style.setProperty(
      "--pointer-x",
      `${Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))}%`,
    );
    surface.style.setProperty(
      "--pointer-y",
      `${Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))}%`,
    );
    surface.style.setProperty("--lens-opacity", "1");
  }
  function clearLensPointer(e) {
    e.currentTarget.style.setProperty("--lens-opacity", "0");
  }
  function startFloatingDrag(event) {
    if (!native || !window.vision?.dragStart) return;
    if (event.button !== 0) return;
    const surface = event.currentTarget,
      pointerId = event.pointerId;
    const startX = event.clientX,
      startY = event.clientY;
    dragMoved.current = false;
    const move = (moveEvent) => {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 3)
        dragMoved.current = true;
      window.vision.dragMove();
    };
    const stop = (stopEvent) => {
      window.vision.dragEnd();
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", stop);
      surface.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      surface.releasePointerCapture?.(pointerId);
      if (dragMoved.current) {
        stopEvent?.preventDefault();
        stopEvent?.stopPropagation();
      }
    };
    window.vision.dragStart();
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", stop, { once: true });
    surface.addEventListener("pointercancel", stop, { once: true });
    window.addEventListener("blur", stop, { once: true });
    surface.setPointerCapture?.(pointerId);
  }
  return (
    <div className="floating-host">
      <motion.div
        className={`unified-bubble floating ${floatingState} ${native ? "native-unified" : ""}`}
        style={{ "--glass-opacity": glassOpacity }}
        initial={false}
        animate={pillGeometry}
        transition={pillTransition}
        onPointerDown={startFloatingDrag}
        onPointerMove={updateLensPointer}
        onPointerEnter={updateLensPointer}
        onPointerLeave={clearLensPointer}
      >
      <span className="bubble-grip" title="拖动悬浮气泡" aria-hidden="true">
        <GripVertical size={14} />
      </span>
      {!showingEvent && (
        <>
          <span className="bubble-brand" aria-hidden="true">
            <b>a</b>
            <i />
          </span>
          <span className="bubble-signal" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </>
      )}
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={showingEvent ? `event-${event.id}` : `total-${state.transitionId}`}
            className="bubble-content-layer"
            initial={
              state.settings.reducedMotion ? false : { opacity: 0, y: 4 }
            }
            animate={{ opacity: 1, y: 0 }}
            exit={
              state.settings.reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }
            }
            transition={{ duration: state.settings.reducedMotion ? 0.01 : 0.16 }}
          >
            {showingEvent ? (
              <EventBubble
                event={event}
                multi={state.settings.markets.length > 1}
                reducedMotion={state.settings.reducedMotion}
              />
            ) : (
              <button
                className={`sales-pill ${native ? "native" : ""} ${authError ? "auth-error" : ""} ${moving ? (up ? "increasing" : "decreasing") : ""} ${state.settings.reducedMotion ? "reduce-motion" : ""}`}
                aria-label={
                  authError
                    ? "Reconnect GerpGo"
                    : `今日销售额 ${value}，点击查看快捷面板`
                }
                style={{
                  "--glass-opacity": glassOpacity,
                }}
                onClick={(e) => {
                  if (dragMoved.current) {
                    dragMoved.current = false;
                    e.preventDefault();
                    return;
                  }
                  if (authError) {
                    e.preventDefault();
                    api.reconnect();
                    return;
                  }
                  onClick?.(e);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onContext?.();
                }}
                title={
                  authError
                    ? "Reconnect GerpGo"
                    : state.error || "今日销售额 · 点击查看 · 右键菜单"
                }
              >
                <span className="glass-sheen" aria-hidden="true" />
                <span
                  key={state.transitionId}
                  className={`number-window ${moving ? "rolling" : ""}`}
                >
                  {moving && (
                    <span className="old-number" aria-hidden="true">
                      {salesAmount(
                        state.previousTotal,
                        state.settings.baseCurrency,
                      )}
                    </span>
                  )}
                  <span className="new-number">{displayValue}</span>
                </span>
              </button>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
function EventBubble({ event: e, multi = false, reducedMotion = false }) {
  if (!e || e.silent) return null;
  let label =
    e.style === "single"
      ? `${e.msku} × ${e.quantity}`
      : e.style === "summary"
        ? `${e.mskus.length} MSKUs / ${e.quantity} Units`
        : `${e.count} ${e.style === "more" ? "More " : ""}${e.type === "REFUND" ? "Refunds" : "Orders"}`;
  const market = multi ? `${e.marketplace} · ` : "";
  return (
    <div
      className={`event-bubble ${e.type.toLowerCase()} ${reducedMotion ? "reduce-motion" : ""}`}
      role="status"
    >
      <span className="glass-sheen" aria-hidden="true" />
      {e.type === "REVIEW" ? (
        e.style === "single" ? (
          <>
            <div className={`stars ${e.rating <= 2 ? "low-rating" : ""}`}>
              {"★".repeat(e.rating)}
              <span>{"☆".repeat(5 - e.rating)}</span>
            </div>
            <strong className="review-sku">
              {market}
              {e.msku}
            </strong>
            <p className="review-snippet">
              {e.content?.slice(0, 42)}
              {e.content?.length > 42 ? "…" : ""}
            </p>
          </>
        ) : (
          <>
            <strong>
              {market}
              {e.count} Reviews
            </strong>
            <p className="review-summary">{e.negativeCount || 0} Negative</p>
          </>
        )
      ) : (
        <>
          <div className="event-line">
            <span className="event-sign">{e.type === "ORDER" ? "+" : "-"}</span>
            <strong>
              {market}
              {label}
            </strong>
          </div>
          <div className="event-money">
            {money(
              e.amount,
              e.currency || MARKETPLACES[e.marketplace].currency,
            )}
          </div>
        </>
      )}
    </div>
  );
}
function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      className={`switch ${checked ? "on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function Row({ icon: Icon, title, description, children }) {
  return (
    <div className="setting-row">
      <span className="row-icon">
        <Icon size={18} />
      </span>
      <div className="row-copy">
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      <div className="row-action">{children}</div>
    </div>
  );
}
function Quick({ state, onSettings, onExit }) {
  return (
    <div className="quick-panel">
      <div className="quick-heading">
        <span className="brand-mini">as</span>Amazon Sales Bubble
        <small>2.2</small>
      </div>
      <div className="connection-mini">
        <i />
        {state.connection === "demo"
          ? "演示工作区"
          : state.connection === "connected"
            ? "GerpGo 已连接"
            : state.connection === "syncing"
              ? "正在同步"
              : "连接待检查"}
      </div>
      <div className="quick-total">
        <span>今日销售额 · {state.settings.baseCurrency}</span>
        <strong>
          {state.hasKnownTotal
            ? money(state.total, state.settings.baseCurrency)
            : "—"}
        </strong>
      </div>
      <div className="quick-actions">
        <button onClick={onSettings}>
          <Settings size={15} />
          设置
        </button>
        <button onClick={onExit}>
          <Power size={15} />
          退出
        </button>
      </div>
    </div>
  );
}
function App() {
  const [state, setState] = useState(null),
    [loadError, setLoadError] = useState(""),
    [tab, setTab] = useState("appearance"),
    [toast, setToast] = useState(""),
    [connect, setConnect] = useState(false),
    [busy, setBusy] = useState(false),
    [quick, setQuick] = useState(false),
    [context, setContext] = useState(false),
    [demoMarket, setDemoMarket] = useState("US"),
    [credentials, setCredentials] = useState({ baseUrl: "https://open.gerpgo.com/api/open", appId: "", appKey: "" });
  useEffect(() => {
    const unsub = api.subscribe(setState);
    api
      .get()
      .then(setState)
      .catch((e) => {
        setLoadError(e.message);
        api.reportError(e.message);
      });
    return unsub;
  }, []);
  useEffect(() => {
    if (state)
      api.ready({
        view,
        viewport: [innerWidth, innerHeight],
        origin: [screenX, screenY],
        root: document.getElementById("root").getBoundingClientRect().toJSON(),
      });
  }, [!!state]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!state)
    return (
      <div className={`startup-placeholder ${view === "widget" ? "mini" : ""}`}>
        {loadError ? "连接暂不可用" : "正在连接…"}
      </div>
    );
  const s = state.settings,
    base = s.baseCurrency,
    providerStores = Array.isArray(state.stores) ? state.stores : [],
    enabledStoreIds = providerStores.filter((store) => store.enabled !== false).map((store) => String(store.id)),
    selectedStoreIds = Array.isArray(s.storeIds) && s.storeIds.length ? s.storeIds.map(String) : enabledStoreIds,
    multi = s.markets.length > 1,
    market = s.markets.includes(demoMarket) ? demoMarket : s.markets[0];
  async function change(value) {
    try {
      await api.settings(value);
    } catch (e) {
      setToast(e.message);
    }
  }
  async function demo(type) {
    try {
      await api.demo({ type, marketplace: market });
    } catch (e) {
      setToast(e.message);
    }
  }
  if (view === "widget")
    return (
      <SalesPill
        key={state.surfaceRevision}
        native
        state={state}
        onClick={() => api.quick()}
        onContext={() => api.context()}
      />
    );
  if (view === "quick")
    return (
      <Quick
        state={state}
        onSettings={() => api.openSettings()}
        onExit={() => api.exit()}
      />
    );
  const tabs = [
    { id: "appearance", name: "显示", icon: Monitor },
    { id: "notifications", name: "事件", icon: Bell },
    { id: "markets", name: "市场", icon: Globe },
    { id: "account", name: "账户", icon: Plug },
    { id: "system", name: "系统", icon: SlidersHorizontal },
  ];
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-symbol">
            <Activity size={23} />
          </span>
          <span>
            amazon<b>sales bubble</b>
          </span>
        </div>
        <nav>
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "selected" : ""}
              onClick={() => {
                setTab(t.id);
                setQuick(false);
                setContext(false);
              }}
            >
              <t.icon size={17} />
              <span>{t.name}</span>
              {tab === t.id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <i />
          2.2<span>LIQUID GLASS</span>
        </div>
      </aside>
      <div className="workspace-main">
        <header>
          <div>
            工作区
            <ChevronRight size={12} />
            <span>{tabs.find((t) => t.id === tab).name}</span>
          </div>
          <span className={`connection-badge ${state.error ? "warning" : ""}`}>
            <i />
            {state.connection === "demo"
              ? "演示工作区"
              : state.connection === "connected"
                ? "GerpGo 已连接"
                : state.connection === "syncing"
                  ? "正在同步"
                  : "未连接"}
          </span>
        </header>
        <main>
          <div className="page-title">
            <h1>
              {tab === "appearance"
                ? "显示"
                : tab === "notifications"
                  ? "事件"
                  : tab === "markets"
                    ? "市场"
                    : tab === "account"
                      ? "账户"
                      : "系统"}
            </h1>
          </div>
          {(tab === "appearance" || tab === "notifications") && (
            <>
              <section className="preview-frame">
                <div className="preview-toolbar">
                  <span>
                    <i />
                    预览
                  </span>
                  <span>
                    悬浮
                  </span>
                </div>
                <div className="desktop-preview floating-preview">
                  <SalesPill
                    state={state}
                    onClick={() => api.quick()}
                    onContext={() => api.context()}
                  />
                </div>
                <div className="preview-footer">
                  <span>
                    <i className={state.active ? "active" : ""} />
                    {state.pending
                      ? `正在合并 ${state.pending} 个事件`
                      : state.active
                        ? {
                            ORDER: "新订单",
                            REFUND: "退款提醒",
                            REVIEW: "新评论",
                          }[state.active.type]
                        : "就绪"}
                    {state.queue ? ` · ${state.queue} 个事件等待中` : ""}
                  </span>
                  <span>
                    {s.markets.join(" / ")} → {base}
                  </span>
                </div>
              </section>
              <section className="demo-bar">
                <div>
                  <span className="demo-icon">
                    <Sparkles size={15} />
                  </span>
                  <strong>演示</strong>
                </div>
                <div className="demo-buttons">
                  <select
                    aria-label="演示事件来源市场"
                    value={market}
                    onChange={(e) => setDemoMarket(e.target.value)}
                  >
                    {s.markets.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={s.source !== "demo"}
                    onClick={() => demo("ORDER")}
                  >
                    <ArrowUpRight size={15} />
                    订单
                  </button>
                  <button
                    disabled={s.source !== "demo"}
                    onClick={() => demo("REFUND")}
                  >
                    <ArrowDownLeft size={15} />
                    退款
                  </button>
                  <button
                    disabled={s.source !== "demo"}
                    onClick={() => demo("REVIEW")}
                  >
                    <Star size={14} />
                    评论
                  </button>
                  <button
                    disabled={s.source !== "demo"}
                    onClick={() => demo("BURST")}
                    aria-label="模拟七笔订单"
                    title="模拟七笔订单"
                  >
                    <Layers size={15} />
                  </button>
                </div>
              </section>
            </>
          )}
          {tab === "appearance" && (
            <>
              <section className="settings-card">
                <Row icon={Layers} title="玻璃浓度">
                  <div className="range">
                    <input
                      type="range"
                      aria-label="悬浮气泡玻璃浓度"
                      min="30"
                      max="100"
                      value={s.glass}
                      onChange={(e) => change({ glass: +e.target.value })}
                    />
                    <span>{s.glass}%</span>
                  </div>
                </Row>
                <Row icon={Activity} title="减少动态">
                  <Toggle
                    checked={s.reducedMotion}
                    label="减少动态效果"
                    onChange={(v) => change({ reducedMotion: v })}
                  />
                </Row>
              </section>
              <div className="integration-card">
                <Monitor size={19} />
                <div>
                  <strong>悬浮模式</strong>
                  <p>整颗气泡可拖动，位置自动保存。</p>
                </div>
                <span className="subtle-tag">可拖动</span>
              </div>
              <div className="page-note">
                <Info size={13} />
                {state.desktop
                  ? state.material === "Windows Acrylic"
                    ? "Acrylic 已启用"
                    : "半透明材质"
                  : "浏览器预览"}
              </div>
            </>
          )}
          {tab === "notifications" && (
            <>
              <div className="section-title">
                <h2>事件开关</h2>
              </div>
              <section className="settings-card">
                <Row
                  icon={ArrowUpRight}
                  title="订单"
                  description="绿色增长反馈"
                >
                  <Toggle
                    checked={s.orders}
                    label="新订单气泡"
                    onChange={(v) => change({ orders: v })}
                  />
                </Row>
                <Row
                  icon={ArrowDownLeft}
                  title="退款"
                  description="红色下降反馈"
                >
                  <Toggle
                    checked={s.refunds}
                    label="退款气泡"
                    onChange={(v) => change({ refunds: v })}
                  />
                </Row>
                <Row icon={Star} title="Review" description="星级与摘要">
                  <Toggle
                    checked={s.reviews}
                    label="Review 气泡"
                    onChange={(v) => change({ reviews: v })}
                  />
                </Row>
              </section>
              <div className="page-note">
                <Info size={13} />
                同一气泡覆盖显示，停留后恢复销售额。
              </div>
            </>
          )}
          {tab === "markets" && (
            <>
              <section className="settings-card">
                <Row
                  icon={Coins}
                  title="Base Currency"
                  description="统一汇总币种"
                >
                  <select
                    aria-label="Base Currency"
                    value={base}
                    onChange={(e) => change({ baseCurrency: e.target.value })}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Row>
              </section>
              {s.source === "gerpgo" && providerStores.length ? (
                <>
                  <div className="section-title">
                    <h2>店铺</h2>
                  </div>
                  <section className="settings-card market-list">
                    {providerStores.map((store) => {
                      const id = String(store.id);
                      const checked = selectedStoreIds.includes(id) && store.enabled !== false;
                      return (
                        <Row
                          key={id}
                          icon={Globe}
                          title={`${store.name} · ${store.marketplaceCode}`}
                          description={`店铺 ID ${id}${store.currency ? ` · ${store.currency}` : ""}${store.enabled === false ? " · 已停用" : ""}`}
                        >
                          <Toggle
                            label={`启用 ${store.name} ${store.marketplaceCode}`}
                            checked={checked}
                            disabled={store.enabled === false}
                            onChange={(v) => {
                              const next = v
                                ? [...new Set([...selectedStoreIds, id])]
                                : selectedStoreIds.filter((value) => value !== id);
                              if (!next.length) {
                                setToast("至少选择一个店铺。");
                                return;
                              }
                              change({ storeIds: next });
                            }}
                          />
                        </Row>
                      );
                    })}
                  </section>
                  <div className="page-note">
                    <Info size={13} />
                    销售、订单、退款和 Review 只统计选中的店铺。
                  </div>
                </>
              ) : (
                <>
                  <div className="section-title">
                    <h2>Marketplace</h2>
                  </div>
                  <section className="settings-card market-list">
                    {Object.entries(MARKETPLACES).map(([key, m]) => (
                      <Row
                        key={key}
                        icon={Globe}
                        title={`${key} · ${m.name}`}
                        description={`${m.currency} · ${m.zone.replaceAll("_", " ")}`}
                      >
                        <Toggle
                          label={`启用 ${key} 市场`}
                          checked={s.markets.includes(key)}
                          onChange={(v) =>
                            change({
                              markets: v
                                ? [...s.markets, key]
                                : s.markets.filter((x) => x !== key),
                            })
                          }
                        />
                      </Row>
                    ))}
                  </section>
                </>
              )}
              <div className="security-note">
                <ShieldCheck size={20} />
                <div>
                  <strong>每日固定汇率</strong>
                  <p>
                    {s.source === "demo" ? "演示汇率" : "统计日首次获取后锁定"}
                  </p>
                </div>
              </div>
              {state.error && (
                <div className="inline-warning" role="status">
                  {state.error}
                </div>
              )}
            </>
          )}
          {tab === "account" && (
            <>
              <section className="account-banner">
                <div className="amazon-mark">
                  a<span>⌣</span>
                </div>
                <div>
                  <h2>Amazon Seller</h2>
                  <p>{s.source === "demo" ? "演示工作区" : "GerpGo OpenAPI"}</p>
                </div>
                <span className="subtle-tag">
                  {s.source === "demo" ? "DEMO" : "GERPGO"}
                </span>
              </section>
              <div className="section-title">
                <h2>连接</h2>
              </div>
              <section className="settings-card">
                <Row
                  icon={Plug}
                  title="GerpGo OpenAPI"
                  description="积加开放平台凭证"
                >
                  <button className="primary" onClick={() => setConnect(true)}>
                    连接账户
                    <ArrowUpRight size={14} />
                  </button>
                </Row>
                <Row
                  icon={RefreshCw}
                  title="连接状态"
                  description={
                    state.error ||
                    (state.lastSync
                      ? `最近同步：${new Date(state.lastSync).toLocaleTimeString()}`
                      : "演示模式")
                  }
                >
                  <button
                    className="secondary"
                    onClick={async () => {
                      await api.reconnect();
                      if (s.source === "demo")
                        setToast(
                          "演示工作区运行正常，连接 GerpGo 后可同步真实数据。",
                        );
                    }}
                  >
                    重新连接
                  </button>
                </Row>
                <Row
                  icon={Star}
                  title="数据能力"
                  description="由 GerpGo API 清单决定"
                >
                  <span className="subtle-tag">
                    {state.capabilities?.orders ? "订单可用" : "订单待确认"}
                  </span>
                </Row>
              </section>
              <div className="section-title">
                <h2>白名单</h2>
              </div>
              <section className="settings-card">
                <Row
                  icon={Globe}
                  title="当前公网 IPv4"
                  description="将此地址添加到 GerpGo IP 白名单"
                >
                  <div className="ip-actions">
                    <code className={`ip-value ${state.publicIp?.status === "error" ? "error" : ""}`}>
                      {state.publicIp?.status === "checking"
                        ? "检测中…"
                        : state.publicIp?.value || (state.publicIp?.error ? "检测失败" : "未检测")}
                    </code>
                    <button
                      className="secondary ip-button"
                      disabled={!state.desktop || state.publicIp?.status === "checking"}
                      onClick={async () => {
                        try {
                          await api.publicIp?.();
                        } catch (e) {
                          setToast(e.message);
                        }
                      }}
                    >
                      刷新
                    </button>
                    <button
                      className="secondary ip-button"
                      disabled={!state.publicIp?.value}
                      onClick={async () => {
                        if (state.publicIp?.value && api.copyText) {
                          await api.copyText(state.publicIp.value);
                          setToast("公网 IP 已复制");
                        }
                      }}
                    >
                      复制
                    </button>
                  </div>
                </Row>
              </section>
              <div className="security-note">
                <ShieldCheck size={20} />
                <div>
                  <strong>本地加密</strong>
                  <p>凭证保存在此设备。</p>
                </div>
              </div>
              {s.source === "gerpgo" && (
                <button
                  className="text-button"
                  onClick={() => change({ source: "demo" })}
                >
                  切换至演示工作区
                  <ArrowRight size={14} />
                </button>
              )}
            </>
          )}
          {tab === "system" && (
            <>
              <section className="settings-card">
                <Row icon={Power} title="开机自动启动">
                  <Toggle
                    checked={s.startup}
                    label="开机自动启动"
                    disabled={!state.desktop}
                    onChange={(v) => change({ startup: v })}
                  />
                </Row>
                <Row
                  icon={Layers}
                  title="悬浮窗口置顶"
                  description="仅悬浮模式生效"
                >
                  <Toggle
                    checked={s.alwaysOnTop !== false}
                    label="悬浮窗口置顶"
                    disabled={!state.desktop}
                    onChange={(v) => change({ alwaysOnTop: v })}
                  />
                </Row>
                <Row
                  icon={ShieldCheck}
                  title="本地数据与去重"
                  description="SQLite 本地保存"
                >
                  <span className="subtle-tag">
                    {state.desktop ? "已启用" : "桌面版支持"}
                  </span>
                </Row>
              </section>
              <div className="about-card">
                <span className="brand-symbol">
                  <Activity size={29} />
                </span>
                <h2>Amazon Sales Bubble</h2>
                <p>2.2 · Liquid Glass</p>
              </div>
            </>
          )}
        </main>
        <footer>
          <span>
            <Check size={12} />
            设置自动保存
          </span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Info size={16} />
          {toast}
        </div>
      )}
      {connect && (
        <div className="modal-backdrop">
          <form
            className="connect-modal"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await api.connect(credentials);
                setCredentials({ baseUrl: "https://open.gerpgo.com/api/open", appId: "", appKey: "" });
                setConnect(false);
                setToast("凭证已加密保存，正在验证 GerpGo 连接。");
              } catch (e) {
                setToast(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <button
              className="modal-close"
              type="button"
              aria-label="关闭"
              onClick={() => setConnect(false)}
            >
              <X size={18} />
            </button>
            <div className="eyebrow">GERPGO OPENAPI</div>
            <h2>连接 GerpGo</h2>
            <p>官方文档未要求单独填写 Host，默认使用积加开放平台代理；只有积加另行提供地址时才需要修改。</p>
            {!state.desktop && (
              <div className="inline-warning">
                请在 Windows 桌面版中连接账户。
              </div>
            )}
            <label>
              API Host（可选）
              <input
                disabled={!state.desktop}
                type="url"
                placeholder="默认：https://open.gerpgo.com/api/open"
                value={credentials.baseUrl}
                onChange={(e) => setCredentials({ ...credentials, baseUrl: e.target.value })}
              />
            </label>
            <label>
              App ID
              <input
                disabled={!state.desktop}
                required
                type="text"
                autoComplete="off"
                value={credentials.appId}
                onChange={(e) => setCredentials({ ...credentials, appId: e.target.value })}
              />
            </label>
            <label>
              App Key
              <input
                disabled={!state.desktop}
                required
                type="password"
                autoComplete="off"
                value={credentials.appKey}
                onChange={(e) => setCredentials({ ...credentials, appKey: e.target.value })}
              />
            </label>
            <button
              disabled={busy || !state.desktop}
              className="primary connect-submit"
            >
              {busy ? "正在连接…" : "加密保存并连接"}
              <ShieldCheck size={15} />
            </button>
            <small>仅保存加密凭证；不会记录 accessToken 或买家信息。</small>
          </form>
        </div>
      )}
    </div>
  );
}
class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    api.reportError(error.message);
  }
  render() {
    return this.state.error ? (
      <div
        className="startup-placeholder mini"
        onClick={() => api.openSettings()}
      >
        暂不可用 · 设置
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <Boundary>
    <App />
  </Boundary>,
);
