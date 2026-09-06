import { randomUUID } from "node:crypto";
import { DeviceIdentityStore } from "./device-identity";
import { GatewayClient } from "./gateway-client";
import { MutationJournal } from "./mutation-journal";
import { ReplayWindow } from "./replay-window";
import { ProtectedRelayStateMachine } from "./state-machine";
import { CcbError } from "./errors";
export class ProtectedRelayHost {
  readonly state = new ProtectedRelayStateMachine();
  readonly identityStore = new DeviceIdentityStore();
  readonly journal = new MutationJournal();
  readonly replayWindow = new ReplayWindow();
  readonly relayInstanceId = randomUUID();
  readonly identity;
  client: GatewayClient | null = null;

  constructor() {
    this.identity = this.identityStore.loadOrCreate();
    this.state.finishBootLocked({
      code: "CCB_GATEWAY_UNAVAILABLE",
      error: "Protected relay is locked until Gateway origin, project, and execution keys are configured.",
    });
  }

  activateIfConfigured(): void {
    if (!process.env.CCB_GATEWAY_ORIGIN || !process.env.CCB_PROJECT_ID || !process.env.CCB_MEMBER_CREDENTIAL) {
      this.state.lock({
        code: "CCB_GATEWAY_UNAVAILABLE",
        error: "Protected tools stay locked without CCB_GATEWAY_ORIGIN, CCB_PROJECT_ID, and CCB_MEMBER_CREDENTIAL.",
      });
      return;
    }
    try {
      this.client?.close();
      this.client = new GatewayClient({
        origin: process.env.CCB_GATEWAY_ORIGIN,
        memberCredential: () => process.env.CCB_MEMBER_CREDENTIAL as string,
      });
      this.state.activate();
    } catch (error) {
      this.client = null;
      this.state.lock({
        code: "CCB_GATEWAY_UNAVAILABLE",
        error: error instanceof CcbError ? error.body.error : "Protected relay failed to activate.",
      });
    }
  }

  close(): void {
    this.client?.close();
    this.client = null;
  }
}
