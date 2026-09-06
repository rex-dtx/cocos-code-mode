import { describe, expect, it } from "vitest";
import type { AuthContext } from "../../src/auth.ts";
import { approveEnrolledDevice, createGrant, enrollDevice, listAdminDevices, listAdminGrants, revokeAdminGrant, revokeEnrolledDevice } from "../../src/cc-bridge/enrollment.ts";
import { CcBridgeStore } from "../../src/cc-bridge/store.ts";

const keys = {
  deviceKeyId: "device-fixture-1",
  publicKeySpki: "MCowBQYDK2VwAyEA" + "A".repeat(43),
};

function auth(role: "admin" | "searcher"): AuthContext {
  return {
    member_id: "member-1",
    label: "fixture",
    jti: "jti-1",
    is_legacy: false,
    clearance: "internal",
    products: ["cc_bridge"],
    tokenAlg: "EdDSA",
    role,
    exp: 2_000_000_000,
  };
}

describe("CC Bridge admin grants", () => {
  it("lets an admin approve, grant, and revoke a device", () => {
    const store = new CcBridgeStore(":memory:");
    const member = auth("searcher");
    const admin = auth("admin");
    const enrolled = enrollDevice(store, member, {
      deviceKeyId: keys.deviceKeyId,
      publicKeySpki: Buffer.alloc(44).toString("base64url"),
      label: "desk",
    });
    expect(enrolled.status).toBe("pending");
    expect(approveEnrolledDevice(store, admin, enrolled.deviceId).status).toBe("approved");
    const grant = createGrant(store, admin, {
      memberId: member.member_id,
      deviceId: enrolled.deviceId,
      operationClass: "mutation",
    });
    expect(listAdminDevices(store, admin).devices).toHaveLength(1);
    expect(listAdminGrants(store, admin).grants).toHaveLength(1);
    expect(revokeAdminGrant(store, admin, grant.grantId).status).toBe("revoked");
    expect(revokeEnrolledDevice(store, admin, enrolled.deviceId).status).toBe("revoked");
  });

  it("rejects grant writes from a non-admin", () => {
    const store = new CcBridgeStore(":memory:");
    expect(() => createGrant(store, auth("searcher"), { operationClass: "read" })).toThrow(/Only an admin/);
  });
});
