"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { GATEWAY_PROTECTED_TOOLS } = require("../../dist/protected/protected-tool-names.js");
const { REMOVED_CUSTOMER_TOOLS } = require("../../dist/protected/removed-tools.js");

describe("protected customer surface", () => {
  it("removes executeJavascript and keeps screenshots/files off the Gateway tool set", () => {
    assert.equal(REMOVED_CUSTOMER_TOOLS.has("executeJavascript"), true);
    assert.equal(GATEWAY_PROTECTED_TOOLS.has("executeJavascript"), false);
    for (const name of ["editorGetScenePreview", "projectReadFile", "projectWriteFile", "assetReadContent"]) {
      assert.equal(GATEWAY_PROTECTED_TOOLS.has(name), false, name);
    }
  });
});
