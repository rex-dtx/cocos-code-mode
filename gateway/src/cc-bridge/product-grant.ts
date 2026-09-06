import type { AuthContext } from "../auth.ts";
import { CcbError } from "./errors.ts";

export const CC_BRIDGE_PRODUCT = "cc_bridge";

export function assertCcBridgeProduct(auth: AuthContext): void {
  if (auth.is_legacy) {
    throw new CcbError("CCB_PRODUCT_DENIED", "Legacy admin credentials cannot execute protected tools.");
  }
  if (auth.tokenAlg !== "EdDSA") {
    throw new CcbError("CCB_AUTH_INVALID", "Protected execute requires an EdDSA member JWT.");
  }
  if (!auth.products?.includes(CC_BRIDGE_PRODUCT)) {
    throw new CcbError("CCB_PRODUCT_DENIED", "Member token is missing the cc_bridge product grant.");
  }
}
