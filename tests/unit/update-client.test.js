"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { assertReleaseOrigin, assertReleaseArtifactUrl } = require("../../dist/update/client.js");

describe("release origin contract", () => {
  it("accepts an exact HTTPS origin and rejects credentials or query", () => {
    const origin = assertReleaseOrigin("https://releases.example.com");
    assert.equal(origin.origin, "https://releases.example.com");
    assert.throws(() => assertReleaseOrigin("http://releases.example.com"), /HTTPS/);
    assert.throws(() => assertReleaseOrigin("https://user:pass@releases.example.com"), /credentials/);
    assert.throws(() => assertReleaseOrigin("https://releases.example.com/?q=1"), /query/);
  });

  it("keeps artifact URLs on the same HTTPS origin", () => {
    const origin = assertReleaseOrigin("https://releases.example.com");
    const artifact = assertReleaseArtifactUrl(origin, "https://releases.example.com/cc-bridge-3x.zip");
    assert.equal(artifact.pathname, "/cc-bridge-3x.zip");
    assert.throws(
      () => assertReleaseArtifactUrl(origin, "https://evil.example.com/cc-bridge-3x.zip"),
      /origin/,
    );
  });
});
