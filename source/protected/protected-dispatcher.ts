import { KeyLike } from "crypto";
import { IJson } from "./canonical-json";
import { CcbError } from "./errors";
import { executeEnvelope, type PrimitiveAdapters, type PrimitiveExecution } from "./primitive-executor";
import { collectObservation, type FieldCollector } from "./observation-collectors";
import { findPublicTool, type PublicToolManifest } from "./public-tool-loader";
import { buildProtectedRequest } from "./request-builder";
import { routeExecutionResult, routeFiniteResult, type LocalExecutionResult } from "./result-router";
import { verifyDecision } from "./decision-verifier";
import type { GatewayClient } from "./gateway-client";
import type { MutationJournal } from "./mutation-journal";
import type { ReplayWindow } from "./replay-window";
import type { DeviceIdentity } from "./device-identity";
import type { ProtectedRelayStateMachine } from "./state-machine";
import { DeviceIdentityStore } from "./device-identity";

export interface DispatcherContext {
  state: ProtectedRelayStateMachine;
  identity: DeviceIdentity;
  identityStore: DeviceIdentityStore;
  projectId: string;
  relayInstanceId: string;
  sequence: ReplayWindow;
  replayWindow: ReplayWindow;
  journal: MutationJournal;
  client: GatewayClient;
  executionKeys: ReadonlyMap<string, KeyLike>;
  expectedCreatorRange: string;
  relay: { build: string; packageHash: string; creatorVersion: string; os: string };
  adapters: PrimitiveAdapters;
  collectField: FieldCollector;
}

export async function dispatchProtectedTool(
  ctx: DispatcherContext,
  manifest: PublicToolManifest,
  toolName: string,
  inputs: IJson,
): Promise<IJson> {
  const finish = ctx.state.beginWork();
  try {
    const tool = findPublicTool(manifest, toolName);
    const observation = collectObservation({
      contractId: tool.observation.contractId,
      consentVersion: tool.observation.consentVersion,
      revisionToken: `${Date.now()}`,
      fields: tool.observation.fields,
    }, ctx.collectField);
    const built = buildProtectedRequest({
      deviceKeyId: ctx.identity.deviceKeyId,
      deviceId: ctx.identity.deviceId,
      projectId: ctx.projectId,
      relayInstanceId: ctx.relayInstanceId,
      sequence: ctx.sequence.nextSequence(),
      tool: { id: tool.name, contractVersion: tool.contractVersion, contractHash: tool.contractHash },
      relay: ctx.relay,
      inputs,
      observation,
      privateKey: ctx.identityStore.privateKey(ctx.identity),
    });
    const signed = await ctx.client.execute(built.signed);
    const verified = verifyDecision({
      request: built.request,
      signed,
      executionKeys: ctx.executionKeys,
      replayWindow: ctx.replayWindow,
      expectedCreatorRange: ctx.expectedCreatorRange,
    });
    if (verified.decision.kind === "result") return routeFiniteResult(verified.decision, built.request);
    const envelope = verified.decision.envelope;
    const toLocal = (execution: PrimitiveExecution): LocalExecutionResult => ({
      commandResults: execution.commandResults,
      summary: { executedCommandIds: execution.executedCommandIds, snapshotTaken: execution.snapshotTaken },
    });
    if (envelope.effect === "none") {
      return routeExecutionResult(envelope, toLocal(await executeEnvelope(envelope, ctx.adapters, built.request)));
    }
    const admission = ctx.journal.prepare(verified.decisionDigest, built.request.requestId, built.request.idempotencyKey);
    if (admission.action === "return-completed") return admission.result;
    ctx.journal.markStarted(verified.decisionDigest);
    const result = routeExecutionResult(envelope, toLocal(await executeEnvelope(envelope, ctx.adapters, built.request)));
    ctx.journal.markCompleted(verified.decisionDigest, result);
    return result;
  } catch (error) {
    if (error instanceof CcbError) throw error;
    throw new CcbError("CCB_INTERNAL", "Protected dispatch failed before a local result was produced.");
  } finally {
    finish();
  }
}
