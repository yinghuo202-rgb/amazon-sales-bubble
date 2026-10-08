function normalizeStore(value) {
  if (!value || value.id == null || !value.name || !value.marketplaceCode) throw Error("GerpGo 店铺字段不完整");
  return {
    id: String(value.id),
    name: String(value.name),
    marketplaceCode: String(value.marketplaceCode),
    countryCode: value.countryCode ? String(value.countryCode) : undefined,
    currency: value.currency ? String(value.currency).toUpperCase() : undefined,
    enabled: value.enabled !== false,
  };
}

const MARKET_ALIASES = Object.freeze({
  "AMAZON.COM": "US", "AMAZON.CA": "CA", "AMAZON.COM.MX": "MX", "AMAZON.CO.UK": "UK",
  "AMAZON.DE": "DE", "AMAZON.CO.JP": "JP",
  "AMAZON-US": "US", "AMAZON-CA": "CA", "AMAZON-MX": "MX", "AMAZON-UK": "UK",
  "AMAZON-DE": "DE", "AMAZON-FR": "FR", "AMAZON-AU": "AU", "AMAZON-JP": "JP", "UNITED STATES": "US", "CANADA": "CA",
  "MEXICO": "MX", "UNITED KINGDOM": "UK", "GERMANY": "DE", "FRANCE": "FR", "AUSTRALIA": "AU", "JAPAN": "JP",
  "美国": "US", "加拿大": "CA", "墨西哥": "MX", "英国": "UK", "德国": "DE", "法国": "FR", "澳大利亚": "AU", "日本": "JP",
});
function normalizeMarketplaceCode(value, fallback = "") {
  const code = String(value || fallback).trim().toUpperCase();
  return MARKET_ALIASES[code] || code;
}

function minorAmount(value, currency) {
  if (value === null || value === undefined || value === "") throw Error("GerpGo 金额字段为空");
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw Error("GerpGo 金额字段无效");
  const digits = currency === "JPY" ? 0 : 2;
  const result = Math.round(number * 10 ** digits);
  if (!Number.isSafeInteger(result)) throw Error("GerpGo 金额超出安全范围");
  return result;
}

function amountObject(value, fallbackCurrency) {
  if (!value || !Number.isFinite(Number(value.currencyAmount))) return null;
  const currency = String(value.currencyCode || fallbackCurrency || "").toUpperCase();
  return currency ? { amount: minorAmount(value.currencyAmount, currency), currency } : null;
}

function capabilities(overrides = {}) {
  return { stores: false, sales: false, orders: false, refunds: false, reviews: false, exchangeRates: false, ...overrides };
}

module.exports = { normalizeStore, normalizeMarketplaceCode, capabilities, minorAmount, amountObject };
