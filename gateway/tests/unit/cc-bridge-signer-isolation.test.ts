import { describe, expect, it } from "vitest";
import { createSigner } from "../../src/cc-bridge/runtime.ts";

describe("CC Bridge production signer isolation", () => {
  it("does not load PKCS8 bytes unless CCB_ALLOW_MEMORY_SIGNER=1", () => {
    const prev = {
      id: process.env.CCB_EXECUTION_KEY_ID,
      pkcs8: process.env.CCB_EXECUTION_PRIVATE_KEY_PKCS8,
      allow: process.env.CCB_ALLOW_MEMORY_SIGNER,
      socket: process.env.CCB_SIGNER_SOCKET,
    };
    try {
      delete process.env.CCB_SIGNER_SOCKET;
      delete process.env.CCB_ALLOW_MEMORY_SIGNER;
      process.env.CCB_EXECUTION_KEY_ID = "execution-prod-1";
      process.env.CCB_EXECUTION_PRIVATE_KEY_PKCS8 = "dGVzdA";
      expect(createSigner().keyId).toBe("unavailable");
    } finally {
      for (const [key, value] of Object.entries({
        CCB_EXECUTION_KEY_ID: prev.id,
        CCB_EXECUTION_PRIVATE_KEY_PKCS8: prev.pkcs8,
        CCB_ALLOW_MEMORY_SIGNER: prev.allow,
        CCB_SIGNER_SOCKET: prev.socket,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
