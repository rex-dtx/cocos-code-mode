"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");

const dist = join(__dirname, "..", "..", "dist", "update", "stager.js");

describe("signed package stager", () => {
  it("rejects path escape and undeclared entries", () => {
    const { assertSafePackageEntry, assertPackageLimits } = require(dist);
    const declared = new Set(["cc-bridge-3x/package.json", "cc-bridge-3x/dist/main.js"]);
    assert.equal(assertSafePackageEntry("cc-bridge-3x/package.json", declared), "cc-bridge-3x/package.json");
    assert.throws(() => assertSafePackageEntry("../secret", declared));
    assert.throws(() => assertSafePackageEntry("cc-bridge-3x/missing.js", declared));
    assert.throws(() => assertPackageLimits(5000));
    assertPackageLimits(2);
  });
});
