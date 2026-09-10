"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { GATEWAY_PROTECTED_TOOLS } = require("../../dist/protected/protected-tool-names.js");
const { REMOVED_CUSTOMER_TOOLS } = require("../../dist/protected/removed-tools.js");

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? javascriptFiles(filePath) : filePath.endsWith(".js") ? [filePath] : [];
  });
}

describe("protected customer surface", () => {
  it("removes executeJavascript and keeps screenshots/files off the Gateway tool set", () => {
    assert.equal(REMOVED_CUSTOMER_TOOLS.has("executeJavascript"), true);
    assert.equal(GATEWAY_PROTECTED_TOOLS.has("executeJavascript"), false);
    for (const name of ["editorGetScenePreview", "projectReadFile", "projectWriteFile", "assetReadContent"]) {
      assert.equal(GATEWAY_PROTECTED_TOOLS.has(name), false, name);
    }
  });

  it("uses Creator-compatible bare builtin specifiers in the packaged runtime", () => {
    const distRoot = path.resolve(__dirname, "../../dist");
    const incompatible = javascriptFiles(distRoot).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return /(?:require|from)\(["']node:|from ["']node:|require\(["'](?:stream|timers)\/promises["']\)|AbortSignal\.timeout/.test(source)
        ? [path.relative(distRoot, filePath)]
        : [];
    });
    assert.deepEqual(incompatible, []);
  });
});
