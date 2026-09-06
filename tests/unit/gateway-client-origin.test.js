"use strict";
const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");

const dist = join(__dirname, "..", "..", "dist", "protected", "gateway-client.js");

describe("GatewayClient origin policy", () => {
  after(() => { delete process.env.CCB_ALLOW_INSECURE_GATEWAY; });

  it("rejects http without the insecure loopback flag", () => {
    const { GatewayClient } = require(dist);
    delete process.env.CCB_ALLOW_INSECURE_GATEWAY;
    assert.throws(() => new GatewayClient({ origin: "http://127.0.0.1:8787", memberCredential: () => "x" }));
  });

  it("accepts loopback http only when CCB_ALLOW_INSECURE_GATEWAY=1", () => {
    const { GatewayClient } = require(dist);
    process.env.CCB_ALLOW_INSECURE_GATEWAY = "1";
    const client = new GatewayClient({ origin: "http://127.0.0.1:8787", memberCredential: () => "x" });
    client.close();
    assert.throws(() => new GatewayClient({ origin: "http://example.com", memberCredential: () => "x" }));
  });
});
