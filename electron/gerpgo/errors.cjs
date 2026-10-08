const ERROR_CODES = Object.freeze([
  "AUTH_FAILED",
  "TOKEN_EXPIRED",
  "RATE_LIMITED",
  "NETWORK_ERROR",
  "SERVER_ERROR",
  "INVALID_RESPONSE",
  "UNSUPPORTED_CAPABILITY",
]);

class GerpGoError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GerpGoError";
    this.code = code;
    Object.assign(this, details);
  }
}

function asGerpGoError(error) {
  if (error?.code && ERROR_CODES.includes(error.code)) return error;
  return new GerpGoError("NETWORK_ERROR", error?.message || "GerpGo 网络请求失败", { cause: error });
}

module.exports = { ERROR_CODES, GerpGoError, asGerpGoError };
