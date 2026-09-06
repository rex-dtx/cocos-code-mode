"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { existsSync, mkdtempSync, writeFileSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const dist = join(__dirname, "..", "..", "dist", "protected", "staged-update.js");

function writePending(dir, bytes) {
  writeFileSync(join(dir, "pending.zip"), bytes);
  writeFileSync(join(dir, "release-manifest.json"), JSON.stringify({
    artifact: "pending.zip",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  }));
}

describe("staged ZIP verifier", () => {
  it("accepts a matching SHA-256 ZIP and rejects a truncated one", () => {
    let verifyStagedZip;
    try {
      ({ verifyStagedZip } = require(dist));
    } catch {
      assert.fail("dist/protected/staged-update.js missing — run npm run build");
    }
    const dir = mkdtempSync(join(tmpdir(), "ccb-staged-"));
    try {
      const bytes = Buffer.from("cc-bridge-staged-zip");
      writePending(dir, bytes);
      assert.equal(verifyStagedZip(dir).sha256.length, 64);
      writeFileSync(join(dir, "pending.zip"), bytes.subarray(0, 4));
      assert.throws(() => verifyStagedZip(dir), /size|hash/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps one rollback slot when activating a verified ZIP", () => {
    const { activateStagedZip } = require(dist);
    const dir = mkdtempSync(join(tmpdir(), "ccb-staged-"));
    try {
      const active = join(dir, "active.zip");
      writePending(dir, Buffer.from("zip-v1"));
      activateStagedZip(dir, active);
      writePending(dir, Buffer.from("zip-v2-bytes"));
      const result = activateStagedZip(dir, active);
      assert.equal(readFileSync(active).toString(), "zip-v2-bytes");
      assert.equal(readFileSync(result.rollback).toString(), "zip-v1");
      assert.equal(existsSync(`${active}.rollback`), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
