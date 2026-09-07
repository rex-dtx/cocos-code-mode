import { createHash, createPublicKey, type KeyLike } from "crypto";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { DeviceIdentity, DeviceIdentityStore } from "./device-identity";
import { GatewayClient } from "./gateway-client";
import { MutationJournal } from "./mutation-journal";
import { ReplayWindow } from "./replay-window";
import { ProtectedRelayStateMachine } from "./state-machine";
import { CcbError } from "./errors";
import { decodeBase64UrlBuffer, randomUUID } from "./node14-compat";
import { SignedRequestCache } from "./request-builder";
import { loadPublicToolManifest } from "./public-tool-loader";
import manifestJson from "./public-tool-manifest.json";

function readGatewayFile(): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), ".cc-bridge", "gateway.json"), "utf8")) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) if (typeof value === "string" && value) out[key] = value;
    return out;
  } catch {
    return {};
  }
}

function verifyCanonicalContract(): void {
  try {
    loadPublicToolManifest(manifestJson);
  } catch (error) {
    throw new CcbError("CCB_CONTRACT_MISMATCH", "Installed canonical protected-tool manifest is invalid.", {
      cause: error instanceof Error ? error.message.slice(0, 512) : String(error).slice(0, 512),
    });
  }
}

interface InstalledPackageMetadata {
  packageSha256: string;
  targetPayloadSha256: string;
}

function installedPackageMetadata(): InstalledPackageMetadata {
  const explicitPackage = process.env.CCB_INSTALLED_PACKAGE_SHA256;
  const explicitTarget = process.env.CCB_INSTALLED_TARGET_PAYLOAD_SHA256;
  if (explicitPackage && /^[a-f0-9]{64}$/.test(explicitPackage)
    && explicitTarget && /^[a-f0-9]{64}$/.test(explicitTarget)) {
    return { packageSha256: explicitPackage, targetPayloadSha256: explicitTarget };
  }
  const roots = [resolve(__dirname, "..", ".."), resolve(__dirname, "..", "..", "..")];
  for (const root of roots) {
    const descriptorPath = join(root, ".ccb-staged.json");
    const manifestPath = join(root, ".ccb-package-manifest.json");
    if (!existsSync(descriptorPath) || !existsSync(manifestPath)) continue;
    const descriptorBytes = readFileSync(descriptorPath);
    const manifestBytes = readFileSync(manifestPath);
    let descriptor: unknown;
    try { descriptor = JSON.parse(descriptorBytes.toString("utf8")); } catch { throw new CcbError("CCB_BUILD_INCOMPATIBLE", "Installed package descriptor is corrupt."); }
    if (!descriptor || typeof descriptor !== "object" || !("packageSha256" in descriptor)
      || !("packageManifestSha256" in descriptor) || !("targetPayloadSha256" in descriptor)
      || typeof descriptor.packageSha256 !== "string" || typeof descriptor.packageManifestSha256 !== "string"
      || typeof descriptor.targetPayloadSha256 !== "string") {
      throw new CcbError("CCB_BUILD_INCOMPATIBLE", "Installed package descriptor does not bind package and target digests.");
    }
    const manifestDigest = createHash("sha256").update(manifestBytes).digest("hex");
    if (manifestDigest !== descriptor.packageManifestSha256 || !/^[a-f0-9]{64}$/.test(descriptor.packageSha256)
      || !/^[a-f0-9]{64}$/.test(descriptor.targetPayloadSha256)) {
      throw new CcbError("CCB_SIGNATURE_INVALID", "Installed package metadata does not match its verified descriptor.");
    }
    return { packageSha256: descriptor.packageSha256, targetPayloadSha256: descriptor.targetPayloadSha256 };
  }
  throw new CcbError("CCB_BUILD_INCOMPATIBLE", "No verified installed package descriptor is available.", { searchedFrom: dirname(__dirname) });
}

export class ProtectedRelayHost {
  readonly state = new ProtectedRelayStateMachine();
  readonly identityStore = new DeviceIdentityStore();
  readonly journal = new MutationJournal();
  readonly replayWindow = new ReplayWindow();
  readonly requestCache = new SignedRequestCache();
  readonly relayInstanceId = randomUUID();
  readonly identity: DeviceIdentity | null;
  readonly packageHash: string | null;
  readonly targetPayloadHash: string | null;
  private readonly bootFailure: CcbError | null;
  client: GatewayClient | null = null;
  executionKeys = new Map<string, KeyLike>();
  projectId: string | null = null;

  constructor() {
    let identity: DeviceIdentity | null = null;
    let packageHash: string | null = null;
    let targetPayloadHash: string | null = null;
    let bootFailure: CcbError | null = null;
    try {
      verifyCanonicalContract();
      identity = this.identityStore.loadOrCreate();
      const installed = installedPackageMetadata();
      packageHash = installed.packageSha256;
      targetPayloadHash = installed.targetPayloadSha256;
    } catch (error) {
      bootFailure = error instanceof CcbError
        ? error
        : new CcbError("CCB_DEVICE_DENIED", "Device identity is corrupt or cannot be durably written.", { cause: error instanceof Error ? error.message.slice(0, 512) : String(error).slice(0, 512) });
    }
    this.identity = identity;
    this.packageHash = packageHash;
    this.bootFailure = bootFailure;
    this.targetPayloadHash = targetPayloadHash;
    this.state.finishBootLocked(bootFailure ? {
      code: bootFailure.body.code,
      error: bootFailure.body.error,
      details: bootFailure.body.details,
    } : {
      code: "CCB_GATEWAY_UNAVAILABLE",
      error: "Protected relay is locked until Gateway origin, project, approval, and execution keys are configured.",
    });
  }

  activateIfConfigured(): void {
    if (this.bootFailure || !this.identity || !this.packageHash) {
      const failure = this.bootFailure ?? new CcbError("CCB_BUILD_INCOMPATIBLE", "Relay identity or installed package digest is unavailable.");
      this.state.lock({ code: failure.body.code, error: failure.body.error, details: failure.body.details });
      return;
    }
    const file = readGatewayFile();
    const origin = process.env.CCB_GATEWAY_ORIGIN || file.origin;
    const projectId = process.env.CCB_PROJECT_ID || file.projectId;
    const memberCredential = process.env.CCB_MEMBER_CREDENTIAL || file.memberCredential;
    const executionKey = process.env.CCB_EXECUTION_PUBLIC_KEY || file.executionPublicKey;
    const approvedDeviceId = process.env.CCB_APPROVED_DEVICE_ID || file.approvedDeviceId;
    const approvedDeviceKeyId = process.env.CCB_APPROVED_DEVICE_KEY_ID || file.approvedDeviceKeyId;
    const keyId = process.env.CCB_EXECUTION_KEY_ID || file.executionKeyId || "execution-dev-1";
    if (!origin || !projectId || !memberCredential || !executionKey || approvedDeviceId !== this.identity.deviceId || approvedDeviceKeyId !== this.identity.deviceKeyId) {
      this.state.lock({
        code: "CCB_DEVICE_DENIED",
        error: "Protected tools stay locked until this exact local identity is enrolled and approved.",
        details: { deviceId: this.identity.deviceId, deviceKeyId: this.identity.deviceKeyId },
      });
      return;
    }
    try {
      this.client?.close();
      this.client = new GatewayClient({
        origin,
        memberCredential: () => memberCredential,
        allowInsecureLoopback: process.env.CCB_ALLOW_INSECURE_GATEWAY === "1" || file.allowInsecureGateway === "1",
      });
      this.executionKeys = new Map([[keyId, createPublicKey({ key: decodeBase64UrlBuffer(executionKey), format: "der", type: "spki" })]]);
      this.projectId = projectId;
      this.state.activate();
    } catch (error) {
      this.client = null;
      this.executionKeys.clear();
      this.projectId = null;
      this.state.lock({ code: error instanceof CcbError ? error.body.code : "CCB_GATEWAY_UNAVAILABLE", error: error instanceof CcbError ? error.body.error : "Protected relay failed to activate." });
    }
  }

  close(): void {
    this.client?.close();
    this.client = null;
    this.executionKeys.clear();
    this.projectId = null;
  }
}
