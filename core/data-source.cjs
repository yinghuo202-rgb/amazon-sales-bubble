class UnsupportedCapabilityError extends Error {
  constructor(capability, message = `${capability} API 当前不可用`) {
    super(message);
    this.name = "UnsupportedCapabilityError";
    this.code = "UNSUPPORTED_CAPABILITY";
    this.capability = capability;
  }
}

/**
 * Provider boundary consumed by the sync/event layer. Implementations return
 * normalized records; UI code must never inspect a provider response.
 */
class CommerceDataSource {
  async connect() { throw new Error("connect() must be implemented"); }
  async getStores() { throw new Error("getStores() must be implemented"); }
  async getBaseCurrency() { throw new Error("getBaseCurrency() must be implemented"); }
  async getExchangeRates() { throw new Error("getExchangeRates() must be implemented"); }
  async getTodaySales() { throw new Error("getTodaySales() must be implemented"); }
  async getOrdersSince() { throw new Error("getOrdersSince() must be implemented"); }
  async getRefundsSince() { throw new Error("getRefundsSince() must be implemented"); }
  async getReviewsSince() { throw new Error("getReviewsSince() must be implemented"); }
}

const emptyCapabilities = () => ({
  stores: false,
  sales: false,
  orders: false,
  refunds: false,
  reviews: false,
  exchangeRates: false,
});

module.exports = { CommerceDataSource, UnsupportedCapabilityError, emptyCapabilities };
