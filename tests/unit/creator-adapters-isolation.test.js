"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const src = readFileSync(join(__dirname, "..", "..", "source", "protected", "creator-adapters.ts"), "utf8");

describe("creator adapters isolation", () => {
  it("cannot import Gateway, fetch, or node http", () => {
    assert.equal(/gateway-client|node:http|node:net|\bfetch\(/.test(src), false);
    assert.match(src, /CreatorChannel/);
  });
});
