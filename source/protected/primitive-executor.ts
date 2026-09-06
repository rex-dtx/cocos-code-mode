import { CcbError } from "./errors";
import { ExecutionEnvelope, ExecutionEnvelopeSchema, PrimitiveCommand, primitiveCommandSemantics } from "./primitive-contract";
import type { ProtectedRequest } from "./protocol";
import { resolveProvenanceValue } from "./value-resolver";

export interface PrimitiveInvocation {
  command: PrimitiveCommand;
}

export interface PrimitiveAdapters {
  invoke(command: PrimitiveCommand): Promise<unknown>;
  snapshot(mode: ExecutionEnvelope["transaction"]["snapshot"]): Promise<void>;
  recheckPreconditions(envelope: ExecutionEnvelope): Promise<void>;
}

export interface PrimitiveExecution {
  commandResults: Map<string, unknown>;
  executedCommandIds: string[];
  snapshotTaken: boolean;
}

export async function executeEnvelope(envelopeInput: unknown, adapters: PrimitiveAdapters, request: ProtectedRequest): Promise<PrimitiveExecution> {
  const envelope = ExecutionEnvelopeSchema.parse(envelopeInput);
  const executedCommandIds: string[] = [];
  const commandResults = new Map<string, unknown>();
  let snapshotTaken = false;
  if (envelope.effect !== "none") await adapters.recheckPreconditions(envelope);
  try {
    for (const command of envelope.commands) {
      primitiveCommandSemantics(command);
      const resolved = { ...command, args: resolveProvenanceValue(command.args, request) } as PrimitiveCommand;
      commandResults.set(command.commandId, await adapters.invoke(resolved));
      executedCommandIds.push(command.commandId);
    }
    if (envelope.transaction.snapshot === "once-after-success") {
      await adapters.snapshot(envelope.transaction.snapshot);
      snapshotTaken = true;
    }
  } catch (error) {
    if (envelope.transaction.snapshot === "once-after-partial-failure") {
      await adapters.snapshot(envelope.transaction.snapshot);
      snapshotTaken = true;
    }
    throw new CcbError("CCB_PARTIAL_EXECUTION", "Primitive execution stopped.", {
      executedCount: executedCommandIds.length,
      lastCommandId: executedCommandIds[executedCommandIds.length - 1] ?? "",
    });
  }
  return { commandResults, executedCommandIds, snapshotTaken };
}
