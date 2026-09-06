import { readFileSync } from "node:fs";
import { decodeProtectedHeader, importSPKI, jwtVerify, type JWTPayload, type KeyLike } from "jose";

export const MEMBER_JWT_ALGORITHM = "EdDSA";
export const DEFAULT_MEMBER_JWT_ISSUER = "mcpdocs";

export type Sensitivity = "public" | "internal" | "confidential" | "restricted";

export interface AuthContext {
  member_id: string;
  label: string;
  group?: string;
  corpora?: string[];
  scopes?: string[];
  jti: string;
  is_legacy: false;
  role?: "viewer" | "searcher" | "admin";
  clearance: Sensitivity;
  products?: string[];
  tokenAlg: "EdDSA";
  exp: number;
}

export interface MemberTokenVerifier {
  verify(token: string): Promise<AuthContext>;
}

export interface MemberTokenVerifierConfig {
  publicKeyPem: string;
  issuer: string;
  audience?: string;
}

export class MemberTokenVerificationError extends Error {
  constructor() {
    super("Member credential is invalid or expired.");
    this.name = "MemberTokenVerificationError";
  }
}

const ROLE_DEFAULT_CLEARANCE: Record<NonNullable<AuthContext["role"]>, Sensitivity> = {
  viewer: "public",
  searcher: "internal",
  admin: "restricted",
};

function requiredString(payload: JWTPayload, name: "sub" | "jti" | "label", maxLength: number): string {
  const value = payload[name];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new MemberTokenVerificationError();
  }
  return value;
}

function optionalString(payload: JWTPayload, name: "group", maxLength: number): string | undefined {
  const value = payload[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new MemberTokenVerificationError();
  }
  return value;
}

function optionalStringArray(
  payload: JWTPayload,
  name: "corpora" | "scopes" | "products",
  maxItems: number,
  maxItemLength: number,
): string[] | undefined {
  const value = payload[name];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maxItems ||
    value.some((item) => typeof item !== "string" || item.length === 0 || item.length > maxItemLength) ||
    new Set(value).size !== value.length
  ) {
    throw new MemberTokenVerificationError();
  }
  return value as string[];
}

function mapClaims(payload: JWTPayload): AuthContext {
  if (
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    (payload.exp as number) <= (payload.iat as number)
  ) {
    throw new MemberTokenVerificationError();
  }
  const role = payload.role;
  if (role !== undefined && role !== "viewer" && role !== "searcher" && role !== "admin") {
    throw new MemberTokenVerificationError();
  }
  const clearance = payload.clearance;
  if (
    clearance !== undefined &&
    clearance !== "public" &&
    clearance !== "internal" &&
    clearance !== "confidential" &&
    clearance !== "restricted"
  ) {
    throw new MemberTokenVerificationError();
  }
  return {
    member_id: requiredString(payload, "sub", 128),
    label: requiredString(payload, "label", 160),
    group: optionalString(payload, "group", 128),
    corpora: optionalStringArray(payload, "corpora", 64, 128),
    scopes: optionalStringArray(payload, "scopes", 64, 128),
    products: optionalStringArray(payload, "products", 32, 64),
    jti: requiredString(payload, "jti", 160),
    is_legacy: false,
    role,
    clearance: clearance ?? (role ? ROLE_DEFAULT_CLEARANCE[role] : "public"),
    tokenAlg: MEMBER_JWT_ALGORITHM,
    exp: payload.exp as number,
  };
}

export function createMemberTokenVerifier(config: MemberTokenVerifierConfig): MemberTokenVerifier {
  const issuer = config.issuer.trim();
  const audience = config.audience?.trim() || undefined;
  if (!issuer || !config.publicKeyPem.includes("BEGIN PUBLIC KEY")) {
    throw new Error("Member JWT verifier requires an issuer and an Ed25519 SPKI public key.");
  }
  const key: Promise<KeyLike> = importSPKI(config.publicKeyPem, MEMBER_JWT_ALGORITHM);
  return {
    async verify(token: string): Promise<AuthContext> {
      try {
        if (decodeProtectedHeader(token).alg !== MEMBER_JWT_ALGORITHM) {
          throw new MemberTokenVerificationError();
        }
        const verified = await jwtVerify(token, await key, {
          algorithms: [MEMBER_JWT_ALGORITHM],
          issuer,
          audience,
          typ: "JWT",
        });
        return mapClaims(verified.payload);
      } catch {
        throw new MemberTokenVerificationError();
      }
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
