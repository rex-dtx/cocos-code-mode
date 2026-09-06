import { createPublicKey, type KeyLike } from "crypto";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { DeviceIdentity, DeviceIdentityStore } from "./device-identity";
import { GatewayClient } from "./gateway-client";
import { MutationJournal } from "./mutation-journal";
import { ReplayWindow } from "./replay-window";
import { ProtectedRelayStateMachine } from "./state-machine";
import { CcbError } from "./errors";
import { decodeBase64UrlBuffer, randomUUID } from "./node14-compat";

function readGatewayFile(): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), ".cc-bridge", "gateway.json"), "utf8")) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}
export class ProtectedRelayHost {
  readonly state = new ProtectedRelayStateMachine();
  readonly identityStore = new DeviceIdentityStore();
  readonly journal = new MutationJournal();
  readonly replayWindow = new ReplayWindow();
  readonly relayInstanceId = randomUUID();
  readonly identity: DeviceIdentity;
  client: GatewayClient | null = null;
  executionKeys = new Map<string, KeyLike>();
  projectId: string | null = null;

  constructor() {
    try {
      this.identity = this.identityStore.loadOrCreate();
    } catch (error) {
      console.error("[cc-bridge-3x] Device identity unavailable; protected tools stay locked:", error);
      this.identity = {
        schemaVersion: 1,
        deviceId: this.relayInstanceId,
        deviceKeyId: "device-unavailable",
        publicKeyDer: "unavailable",
        privateKeyDer: "unavailable",
        createdAt: new Date().toISOString(),
      };
    }
    this.state.finishBootLocked({
      code: "CCB_GATEWAY_UNAVAILABLE",
      error: "Protected relay is locked until Gateway origin, project, and execution keys are configured.",
    });
  }

  activateIfConfigured(): void {
    const file = readGatewayFile();
    const origin = process.env.CCB_GATEWAY_ORIGIN || file.origin;
    const projectId = process.env.CCB_PROJECT_ID || file.projectId;
    const memberCredential = process.env.CCB_MEMBER_CREDENTIAL || file.memberCredential;
    const executionKey = process.env.CCB_EXECUTION_PUBLIC_KEY || file.executionPublicKey;
    const keyId = process.env.CCB_EXECUTION_KEY_ID || file.executionKeyId || "execution-dev-1";
    if (!origin || !projectId || !memberCredential || !executionKey) {
      this.state.lock({
        code: "CCB_GATEWAY_UNAVAILABLE",
        error: "Protected tools stay locked without Gateway origin, project, member credential, and execution public key.",
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
      this.state.lock({
        code: "CCB_GATEWAY_UNAVAILABLE",
        error: error instanceof CcbError ? error.body.error : "Protected relay failed to activate.",
      });
    }
  }

  close(): void {
    this.client?.close();
    this.client = null;
    this.executionKeys.clear();
    this.projectId = null;
  }

}
