import { createPublicKey, type KeyLike } from "crypto";
import { DeviceIdentity, DeviceIdentityStore } from "./device-identity";
import { GatewayClient } from "./gateway-client";
import { MutationJournal } from "./mutation-journal";
import { ReplayWindow } from "./replay-window";
import { ProtectedRelayStateMachine } from "./state-machine";
import { CcbError } from "./errors";
import { decodeBase64UrlBuffer, randomUUID } from "./node14-compat";
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
    const origin = process.env.CCB_GATEWAY_ORIGIN;
    const projectId = process.env.CCB_PROJECT_ID;
    const memberCredential = process.env.CCB_MEMBER_CREDENTIAL;
    const executionKey = process.env.CCB_EXECUTION_PUBLIC_KEY;
    const keyId = process.env.CCB_EXECUTION_KEY_ID || "execution-fixture-1";
    if (!origin || !projectId || !memberCredential || !executionKey) {
      this.state.lock({
        code: "CCB_GATEWAY_UNAVAILABLE",
        error: "Protected tools stay locked without Gateway origin, project, member credential, and execution public key.",
      });
      return;
    }
    try {
      this.client?.close();
      this.client = new GatewayClient({ origin, memberCredential: () => memberCredential });
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
