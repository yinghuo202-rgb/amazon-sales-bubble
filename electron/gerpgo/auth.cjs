const { GerpGoError } = require("./errors.cjs");

class GerpGoAuth {
  constructor(client) { this.client = client; }
  async connect() {
    try {
      const token = await this.client.authenticate();
      return { connected: true, tokenExpiresAt: token.expiresAt || null };
    } catch (error) {
      if (error instanceof GerpGoError) throw error;
      throw new GerpGoError("AUTH_FAILED", error.message || "GerpGo 授权失败", { cause: error });
    }
  }
}

module.exports = { GerpGoAuth };
