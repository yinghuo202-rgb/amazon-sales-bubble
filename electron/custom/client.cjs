class GenericRestError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GenericRestError";
    this.code = code;
    Object.assign(this, details);
  }
}

function payloadMessage(payload, fallback) {
  if (Array.isArray(payload?.messages) && payload.messages.length) return String(payload.messages[0]);
  if (typeof payload?.message === "string" && payload.message) return payload.message;
  return fallback;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

class GenericRestClient {
  constructor({ baseUrl, token, tokenHeader = "Authorization", tokenPrefix = "Bearer ", timeoutMs = 30000, fetcher = fetch } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = String(token || "");
    this.tokenHeader = String(tokenHeader || "Authorization");
    this.tokenPrefix = tokenPrefix == null ? "Bearer " : String(tokenPrefix);
    this.timeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : 30000;
    this.fetcher = fetcher;
  }

  async request(path, { method = "GET", body, query = {}, headers = {} } = {}) {
    if (!/^https?:\/\//i.test(this.baseUrl)) throw new GenericRestError("AUTH_FAILED", "请填写有效的 ERP API 地址。", { status: 0 });
    const target = /^https?:\/\//i.test(String(path || ""))
      ? String(path)
      : `${this.baseUrl}/${String(path || "").replace(/^\/+/, "")}`;
    const url = new URL(target);
    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
      }
    }
    const requestHeaders = { accept: "application/json", ...headers };
    if (this.token) requestHeaders[this.tokenHeader] = `${this.tokenPrefix}${this.token}`;
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (serialized !== undefined) requestHeaders["content-type"] = "application/json";
    let response;
    try {
      response = await this.fetcher(url, { method, headers: requestHeaders, body: serialized, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw new GenericRestError("NETWORK_ERROR", error.message || "ERP 网络请求失败", { cause: error });
    }
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { throw new GenericRestError("INVALID_RESPONSE", "ERP 返回的不是有效 JSON。", { status: response.status }); }
    if (response.status === 401 || response.status === 403) throw new GenericRestError("AUTH_FAILED", payloadMessage(payload, `ERP 鉴权失败 (${response.status})。`), { status: response.status, payload });
    if (response.status === 429) throw new GenericRestError("RATE_LIMITED", "ERP API 已限流。", { status: response.status, payload });
    if (response.status >= 500) throw new GenericRestError("SERVER_ERROR", `ERP 服务异常 (${response.status})。`, { status: response.status, payload });
    if (!response.ok) throw new GenericRestError("INVALID_RESPONSE", payloadMessage(payload, `ERP 请求失败 (${response.status})。`), { status: response.status, payload });
    if (payload && payload.code !== undefined && ![0, 200, "0", "200", "success", "SUCCESS"].includes(payload.code))
      throw new GenericRestError("INVALID_RESPONSE", payloadMessage(payload, `ERP 业务请求失败 (${payload.code})。`), { status: response.status, payload });
    return payload;
  }
}

module.exports = { GenericRestClient, GenericRestError, normalizeBaseUrl };
