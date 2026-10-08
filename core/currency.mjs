// GerpGo returns the ERP base currency as an ISO code. Keep the settings
// picker and conversion guard broad enough for the currencies documented by
// its sales and exchange-rate APIs.
export const CURRENCIES = [
  "USD", "CAD", "MXN", "GBP", "EUR", "JPY", "CNY", "AUD", "NZD", "SGD",
  "HKD", "KRW", "INR", "BRL", "PLN", "SEK", "NOK", "DKK", "CHF", "TRY",
  "ZAR", "AED", "SAR", "THB", "VND", "CLP", "COP", "CZK", "HUF", "ILS",
  "MYR", "PHP", "IDR", "TWD",
];
export const SCALE = 1000000000;
export const digits = (currency) => (currency === "JPY" ? 0 : 2);
export const isCurrencyCode = (currency) =>
  typeof currency === "string" && /^[A-Z]{3}$/.test(currency);
export const DEMO_USD = Object.freeze({
  USD: 1,
  CAD: 0.73,
  MXN: 0.052,
  GBP: 1.3,
  EUR: 1.1,
  JPY: 0.0067,
  CNY: 0.14,
  AUD: 0.66,
  NZD: 0.61,
  SGD: 0.74,
  HKD: 0.128,
  KRW: 0.00074,
  INR: 0.012,
  BRL: 0.18,
  CHF: 1.12,
});
export function scaledRate(rate) {
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100000)
    throw Error("Invalid exchange rate");
  return Math.round(rate * SCALE);
}
export function convertMinor(amount, source, target, rateScaled) {
  if (
    !Number.isSafeInteger(amount) ||
    !isCurrencyCode(source) ||
    !isCurrencyCode(target) ||
    !Number.isSafeInteger(rateScaled) ||
    rateScaled <= 0
  )
    throw Error("Invalid currency conversion");
  const sign = amount < 0 ? -1n : 1n;
  const numerator =
    BigInt(Math.abs(amount)) *
    BigInt(rateScaled) *
    10n ** BigInt(digits(target));
  const denominator = BigInt(SCALE) * 10n ** BigInt(digits(source));
  const result = Number(sign * ((numerator + denominator / 2n) / denominator));
  if (!Number.isSafeInteger(result))
    throw Error("Money exceeds safe integer range");
  return result;
}
export function demoRate(source, target) {
  const sourceRate = DEMO_USD[source] || 1;
  const targetRate = DEMO_USD[target] || 1;
  return scaledRate(sourceRate / targetRate);
}
