const { createHash } = require("node:crypto");
const { GerpGoError } = require("./errors.cjs");
const { config } = require("./config.cjs");
const endpoints = require("./endpoints.cjs");

function redactedHeaders(headers) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) =>
    /authorization|token|secret|key|sign/i.test(key) ? [key, "[redacted]"] : [key, value]));
}

function requestSignature(bodyText, appKey) {
  return createHash("md5").update(`${bodyText ?? ""}${appKey}`, "utf8").digest("hex");
}

function payloadMessage(payload, fallback) {
  const messages = Array.isArray(payload?.messages) ? payload.messages.filter(Boolean) : [];
  return messages[0] || (typeof payload?.message === "string" ? payload.message : fallback);
}

class GerpGoClient {
  constructor({ credentials = {}, baseUrl, fetcher = fetch, timeoutMs } = {}) {
    this.credentials = { ...credentials };
    this.options = config({ baseUrl, timeoutMs });
    this.fetcher = fetcher;
    this.accessToken = null;
    this.expiresAt = 0;
    this.logger = null;
  }

  setLogger(logger) { this.logger = typeof logger === "function" ? logger : null; }

  token(value, expiresAt = 0) {
    this.accessToken = value || null;
    this.expiresAt = Number.isFinite(expiresAt) ? expiresAt : 0;
  }

  hasUsableToken() {
    return Boolean(this.accessToken) && (!this.expiresAt || Date.now() < this.expiresAt - 60000);
  }

  async authenticate() {
    if (!this.options.baseUrl) throw new GerpGoError("AUTH_FAILED", "未配置 GerpGo API 地址，无法连接。");
    const response = await this.requestRaw(endpoints.token, { method: "POST", body: this.credentials }, true);
    const data = response?.data && typeof response.data === "object" ? response.data : response;
    // Only the accessToken concept is verified by the supplied specification.
    const accessToken = data?.accessToken;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new GerpGoError("INVALID_RESPONSE", "GerpGo 未返回文档确认的 accessToken 字段。");
    }
    // `expiresOut` is the documented remaining lifetime; fall back to the
    // total lifetime for providers that omit it in a compatible response.
    const expires = data?.expiresOut ?? data?.expiresIn ?? data?.expireTime;
    let expiresAt = 0;
    if (Number.isFinite(expires)) expiresAt = expires > 1e12 ? expires : Date.now() + expires * 1000;
    this.token(accessToken, expiresAt);
    return { accessToken, expiresAt };
  }

  async request(path, options = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.hasUsableToken()) await this.authenticate();
      try {
        return await this.requestRaw(path, { ...options, token: this.accessToken }, false);
      } catch (error) {
        if (error.code !== "TOKEN_EXPIRED" || attempt > 0) throw error;
        this.accessToken = null;
      }
    }
    throw new GerpGoError("TOKEN_EXPIRED", "GerpGo token 已失效。");
  }

  async requestRaw(path, { method = "GET", body, token = null, headers = {} } = {}, authRequest = false) {
    if (!this.options.baseUrl) throw new GerpGoError("NETWORK_ERROR", "未配置 GerpGo API 地址。");
    const url = `${this.options.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const requestHeaders = { accept: "application/json", ...headers };
    // Keep the exact compact JSON string used for the body. GerpGo's signing
    // rule hashes this string plus appKey, so re-serializing at another point
    // would make an otherwise valid request fail with 40001.
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    if (serializedBody !== undefined) requestHeaders["content-type"] = "application/json";
    // The public documents explicitly name the business request header
    // `accessToken`; do not substitute an Authorization/Bearer header.
    if (token) requestHeaders.accessToken = token;
    // Accounts with "接口签名验证" enabled require a lower-case MD5 sign on
    // every business request. The token exchange itself is intentionally
    // unsigned and is identified by authRequest.
    if (token && this.credentials.appKey && !authRequest) {
      requestHeaders.sign = requestSignature(serializedBody, this.credentials.appKey);
    }
    this.logger?.("request", { path, method, headers: redactedHeaders(requestHeaders) });
    let response;
    try {
      response = await this.fetcher(url, {
        method,
        headers: requestHeaders,
        body: serializedBody,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw new GerpGoError("NETWORK_ERROR", error.message || "GerpGo 网络请求失败", { cause: error });
    }
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { throw new GerpGoError("INVALID_RESPONSE", "GerpGo 返回的不是有效 JSON。"); }
    this.logger?.("response", { path, status: response.status, authRequest });
    if (response.status === 401 || response.status === 403) {
      this.accessToken = null;
      throw new GerpGoError(authRequest ? "AUTH_FAILED" : "TOKEN_EXPIRED", `GerpGo 请求未授权 (${response.status})。`, { status: response.status, payload });
    }
    if (response.status === 429) throw new GerpGoError("RATE_LIMITED", "GerpGo API 已限流。", { status: response.status, retryAfter: response.headers.get("retry-after") });
    if (response.status >= 500) throw new GerpGoError("SERVER_ERROR", `GerpGo 服务异常 (${response.status})。`, { status: response.status, payload });
    if (!response.ok) {
      const fallback = `GerpGo 请求失败 (${response.status})。`;
      throw new GerpGoError(authRequest ? "AUTH_FAILED" : "INVALID_RESPONSE", payloadMessage(payload, fallback), { status: response.status, payload });
    }
    if (payload && payload.code !== undefined && Number(payload.code) !== 200)
      throw new GerpGoError(authRequest ? "AUTH_FAILED" : "INVALID_RESPONSE", payload.messages?.[0] || `GerpGo 业务请求失败 (${payload.code})。`, { status: response.status, payload });
    return payload;
  }
}

module.exports = { GerpGoClient, requestSignature };
