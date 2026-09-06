import { randomUUID } from "node:crypto";
import { DeviceIdentityStore } from "./device-identity";
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

  constructor() {
    this.identity = this.identityStore.loadOrCreate();
    this.state.finishBootLocked({
      code: "CCB_GATEWAY_UNAVAILABLE",
      error: "Protected relay is locked until Gateway origin, project, and execution keys are configured.",
    });
  }

  activateIfConfigured(): void {
    if (!process.env.CCB_GATEWAY_ORIGIN || !process.env.CCB_PROJECT_ID) {
      this.state.lock({
        code: "CCB_GATEWAY_UNAVAILABLE",
        error: "Protected tools stay locked without CCB_GATEWAY_ORIGIN and CCB_PROJECT_ID.",
      });
      return;
    }
    try {
      this.state.activate();
    } catch (error) {
      this.state.lock({
        code: "CCB_GATEWAY_UNAVAILABLE",
        error: error instanceof CcbError ? error.body.error : "Protected relay failed to activate.",
      });
    }
  }
}
