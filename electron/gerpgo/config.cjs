const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_POLL_INTERVAL_MS = 30000;
const DEFAULT_RECONCILIATION_INTERVAL_MS = 300000;
// The public docs UI proxies the business API through /api/open.
const DEFAULT_BASE_URL = "https://open.gerpgo.com/api/open";

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/$/, "");
  if (!raw) return DEFAULT_BASE_URL;
  if (/^https:\/\/open\.gerpgo\.com(?:\/api)?$/i.test(raw)) return DEFAULT_BASE_URL;
  if (/^https:\/\/sandbox\.open\.gerpgo\.com(?:\/api)?$/i.test(raw)) return "https://sandbox.open.gerpgo.com/api/open";
  return raw;
}

function config(overrides = {}) {
  return {
    baseUrl: normalizeBaseUrl(overrides.baseUrl || process.env.GERPGO_BASE_URL),
    timeoutMs: Number.isFinite(overrides.timeoutMs) ? overrides.timeoutMs : DEFAULT_TIMEOUT_MS,
    pollIntervalMs: Number.isFinite(overrides.pollIntervalMs) ? overrides.pollIntervalMs : DEFAULT_POLL_INTERVAL_MS,
    reconciliationIntervalMs: Number.isFinite(overrides.reconciliationIntervalMs) ? overrides.reconciliationIntervalMs : DEFAULT_RECONCILIATION_INTERVAL_MS,
  };
}

module.exports = { config, normalizeBaseUrl, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, DEFAULT_POLL_INTERVAL_MS, DEFAULT_RECONCILIATION_INTERVAL_MS };
