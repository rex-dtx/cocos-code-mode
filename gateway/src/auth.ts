import { readFileSync } from "node:fs";
import {
  MEMBER_JWT_ALGORITHM,
  createMemberTokenVerifier as createNeutralMemberTokenVerifier,
  type MemberRole,
  type MemberTokenVerifierConfig,
  type Sensitivity,
  type VerifiedMemberClaims,
} from "@dtx/tool-auth";

export { MEMBER_JWT_ALGORITHM, MemberTokenVerificationError } from "@dtx/tool-auth";
export const DEFAULT_MEMBER_JWT_ISSUER = "mcpdocs";

export type { MemberTokenVerifierConfig, Sensitivity } from "@dtx/tool-auth";

export interface AuthContext {
  member_id: string;
  label: string;
  group?: string;
  corpora?: string[];
  scopes?: string[];
  jti: string;
  is_legacy: false;
  role?: MemberRole;
  clearance: Sensitivity;
  products?: string[];
  tokenAlg: "EdDSA";
  exp: number;
}

export interface MemberTokenVerifier {
  verify(token: string): Promise<AuthContext>;
}

export type { MemberRole };

const ROLE_DEFAULT_CLEARANCE: Record<NonNullable<AuthContext["role"]>, Sensitivity> = {
  viewer: "public",
  searcher: "internal",
  admin: "restricted",
};

function mapVerifiedClaims(claims: VerifiedMemberClaims): AuthContext {
  return {
    member_id: claims.sub,
    label: claims.label,
    group: claims.group,
    corpora: claims.corpora,
    scopes: claims.scopes,
    jti: claims.jti,
    is_legacy: false,
    role: claims.role,
    clearance: claims.clearance ?? (claims.role ? ROLE_DEFAULT_CLEARANCE[claims.role] : "public"),
    products: claims.products,
    tokenAlg: claims.tokenAlg,
    exp: claims.exp,
  };
}

export function createMemberTokenVerifier(config: MemberTokenVerifierConfig): MemberTokenVerifier {
  const neutralVerifier = createNeutralMemberTokenVerifier(config);
  return {
    async verify(token: string): Promise<AuthContext> {
      return mapVerifiedClaims(await neutralVerifier.verify(token));
    },
  };
}

export function createMemberTokenVerifierFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MemberTokenVerifier {
  const inlinePem = env.DTX_MEMBER_JWT_PUBLIC_KEY;
  const publicKeyPath = env.DTX_MEMBER_JWT_PUBLIC_KEY_PATH;
  if (inlinePem && publicKeyPath) {
    throw new Error("Configure only one of DTX_MEMBER_JWT_PUBLIC_KEY or DTX_MEMBER_JWT_PUBLIC_KEY_PATH.");
  }
  const publicKeyPem = inlinePem ?? (publicKeyPath ? readFileSync(publicKeyPath, "utf8") : "");
  if (!publicKeyPem) {
    throw new Error(
      "Member JWT public key is required. Set DTX_MEMBER_JWT_PUBLIC_KEY_PATH to a read-only Ed25519 SPKI PEM.",
    );
  }
  return createMemberTokenVerifier({
    publicKeyPem,
    issuer: env.DTX_MEMBER_JWT_ISSUER?.trim() || DEFAULT_MEMBER_JWT_ISSUER,
    audience: env.DTX_MEMBER_JWT_AUDIENCE,
  });
}
