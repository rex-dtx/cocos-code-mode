import { KeyLike } from "crypto";
import { assertIJson, IJson } from "./canonical-json";
import { CcbError } from "./errors";
import { executeEnvelope, type PrimitiveAdapters, type PrimitiveExecution } from "./primitive-executor";
import { collectObservation, type ObservationRuntime, recheckObservation } from "./observation-collectors";
import { findPublicTool, findPublicToolOperation, type PublicToolManifest } from "./public-tool-loader";
import { buildProtectedRequest, canonicalToolInputDigest, SignedRequestCache } from "./request-builder";
import { routeExecutionResult, routeFiniteResult, type LocalExecutionResult } from "./result-router";
import { verifyDecision } from "./decision-verifier";
import type { GatewayClient } from "./gateway-client";
import type { MutationJournal, JournalOutcomeEvidence } from "./mutation-journal";
import type { ReplayWindow } from "./replay-window";
import type { DeviceIdentity } from "./device-identity";
import type { ProtectedRelayStateMachine } from "./state-machine";
import { DeviceIdentityStore } from "./device-identity";

export interface ProtectedDispatchContext {
  idempotencyKey?: string;
}

export interface DispatcherContext {
  state: ProtectedRelayStateMachine;
  identity: DeviceIdentity;
  identityStore: DeviceIdentityStore;
  projectId: string;
  relayInstanceId: string;
  sequence: ReplayWindow;
  replayWindow: ReplayWindow;
  journal: MutationJournal;
  requestCache: SignedRequestCache;
  client: GatewayClient;
  executionKeys: ReadonlyMap<string, KeyLike>;
  relay: { build: string; packageHash: string; creatorVersion: string; os: string };
  adapters: PrimitiveAdapters;
  observationRuntime: ObservationRuntime;
}

function evidenceFromError(error: CcbError): JournalOutcomeEvidence {
  const details = error.body.details;
  const attempted = typeof details.attemptedCommandIds === "string" && details.attemptedCommandIds ? details.attemptedCommandIds.split(",") : [];
  const completed = typeof details.executedCommandIds === "string" && details.executedCommandIds ? details.executedCommandIds.split(",") : [];
  return {
    attemptedCommandIds: attempted,
    completedCommandIds: completed,
    failingCommandId: typeof details.failingCommandId === "string" && details.failingCommandId ? details.failingCommandId : undefined,
    causalCode: typeof details.causalCode === "string" && details.causalCode ? details.causalCode : error.body.code,
    cause: typeof details.cause === "string" ? details.cause : error.body.error,
    snapshot: {
      attempted: details.snapshotAttempted === true,
      completed: details.snapshotCompleted === true,
      ...(typeof details.snapshotError === "string" && details.snapshotError ? { error: details.snapshotError } : {}),
    },
  };
}

function localResult(execution: PrimitiveExecution): LocalExecutionResult {
  const summary: IJson = {
    attemptedCommandIds: execution.attemptedCommandIds,
    executedCommandIds: execution.executedCommandIds,
    snapshotTaken: execution.snapshotTaken,
    snapshotOutcome: {
      attempted: execution.snapshotOutcome.attempted,
      completed: execution.snapshotOutcome.completed,
      ...(execution.snapshotOutcome.error ? { error: execution.snapshotOutcome.error } : {}),
    },
    ipcCount: execution.ipcCount,
  };
  return { commandResults: execution.commandResults, summary };
}

export async function dispatchProtectedTool(
  ctx: DispatcherContext,
  manifest: PublicToolManifest,
  toolName: string,
  inputs: IJson,
  dispatch: ProtectedDispatchContext = {},
): Promise<IJson> {
  const finish = ctx.state.beginWork();
  try {
    const tool = findPublicTool(manifest, toolName);
    const operation = findPublicToolOperation(tool, inputs);
    if (operation.effect !== "none" && !dispatch.idempotencyKey) {
      throw new CcbError("CCB_AUTH_REQUIRED", "Effectful protected calls require an authenticated stable idempotency key.");
    }
    const toolBinding = { id: tool.name, contractVersion: tool.contractVersion, contractHash: tool.contractHash };
    const inputDigest = canonicalToolInputDigest(toolBinding, inputs);
    assertIJson(tool.publicConstants);
    const publicConstants: IJson = tool.publicConstants as IJson;
    const build = async () => {
      const observation = await collectObservation(operation.observation, inputs, ctx.observationRuntime);
      return buildProtectedRequest({
        deviceKeyId: ctx.identity.deviceKeyId,
        deviceId: ctx.identity.deviceId,
        projectId: ctx.projectId,
        relayInstanceId: ctx.relayInstanceId,
        sequence: ctx.sequence.nextSequence(),
        tool: toolBinding,
        relay: ctx.relay,
        inputs,
        observation,
        idempotencyKey: dispatch.idempotencyKey,
        privateKey: ctx.identityStore.privateKey(ctx.identity),
      });
    };
    const built = dispatch.idempotencyKey
      ? await ctx.requestCache.getOrBuild(dispatch.idempotencyKey, inputDigest, build)
      : await build();
    const signed = await ctx.client.execute(built.signed);
    const verified = verifyDecision({
      request: built.request,
      signed,
      executionKeys: ctx.executionKeys,
      replayWindow: ctx.replayWindow,
      tool,
      operation,
    });
    if (verified.decision.kind === "result") return routeFiniteResult(verified.decision, built.request);
    const envelope = verified.decision.envelope;
    const adapters: PrimitiveAdapters = {
      ...ctx.adapters,
      recheckPreconditions: async (signedEnvelope) => {
        if (operation.observation.contractId === "none-v1" || !built.request.observation) {
          throw new CcbError("CCB_PRECONDITION_FAILED", "Effect envelope has no canonical observation to recheck.");
        }
        await recheckObservation(operation.observation, inputs, built.request.observation, ctx.observationRuntime);
        for (const precondition of signedEnvelope.preconditions) {
          if (precondition.revisionToken !== built.request.observation.revisionToken || precondition.digest !== built.request.observation.digest) {
            throw new CcbError("CCB_PRECONDITION_FAILED", "Signed precondition does not match the authorized observation.");
          }
        }
      },
    };
    if (envelope.effect === "none") {
      const execution = await executeEnvelope(envelope, adapters, built.request, {
        publicConstants,
        deadlineAtMs: verified.deadlineAtMs,
      });
      return routeExecutionResult(envelope, localResult(execution));
    }

    const admission = ctx.journal.prepare(verified.decisionDigest, built.request.requestId, built.request.idempotencyKey);
    if (admission.action === "return-completed") return admission.result;
    let started = false;
    try {
      const execution = await executeEnvelope(envelope, adapters, built.request, {
        publicConstants,
        deadlineAtMs: verified.deadlineAtMs,
        onEffectAttempt: (commandId) => {
          ctx.journal.markStarted(verified.decisionDigest, commandId);
          started = true;
        },
      });
      const result = routeExecutionResult(envelope, localResult(execution));
      ctx.journal.markCompleted(verified.decisionDigest, result, {
        attemptedCommandIds: execution.attemptedCommandIds,
        completedCommandIds: execution.executedCommandIds,
        snapshot: execution.snapshotOutcome,
      });
      return result;
    } catch (error) {
      if (started) {
        const ccb = error instanceof CcbError ? error : new CcbError("CCB_OUTCOME_UNKNOWN", "Creator effect may have begun.");
        const outcome = ccb.body.code === "CCB_OUTCOME_UNKNOWN"
          ? ccb
          : new CcbError("CCB_OUTCOME_UNKNOWN", ccb.body.error, ccb.body.details);
        try {
          ctx.journal.markOutcomeUnknown(verified.decisionDigest, evidenceFromError(outcome));
        } catch (journalError) {
          throw new CcbError("CCB_OUTCOME_UNKNOWN", outcome.body.error, {
            ...outcome.body.details,
            journalError: journalError instanceof Error ? journalError.message.slice(0, 512) : String(journalError).slice(0, 512),
          });
        }
        throw outcome;
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof CcbError) throw error;
    throw new CcbError("CCB_INTERNAL", "Protected dispatch failed before a local result was produced.", {
      cause: error instanceof Error ? error.message.slice(0, 512) : String(error).slice(0, 512),
    });
  } finally {
    finish();
  }
}
