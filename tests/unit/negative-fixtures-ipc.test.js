"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

describe("protected negative fixtures", () => {
  it("reject 50 tamper cases with zero Creator mutation IPC", () => {
    const ran = spawnSync(process.execPath, [join(__dirname, "..", "..", "scripts", "verify-protected-fixtures.js")], {
      encoding: "utf8",
    });
    assert.equal(ran.status, 0, ran.stderr || ran.stdout);
    const line = ran.stdout.trim().split("\n").at(-1);
    const report = JSON.parse(line);
    assert.equal(report.ok, true);
    assert.equal(report.negativeCases, 50);
  });
});
