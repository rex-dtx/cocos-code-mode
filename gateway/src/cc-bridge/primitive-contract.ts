import { z } from "zod";

export const EffectSchema = z.enum(["none", "local-state", "project-write", "external-side-effect"]);
export type Effect = z.infer<typeof EffectSchema>;

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const jsonPointer = z.string().min(1).max(1024).regex(/^(?:\/(?:[^~/]|~0|~1)*)+$/);
const requestValue = z.object({ source: z.literal("request"), jsonPointer }).strict();
const observationValue = z.object({ source: z.literal("observation"), jsonPointer }).strict();
const contractConstant = z.object({ source: z.literal("public-contract-constant"), id: identifier }).strict();
export const PrimitiveValueRefSchema = z.discriminatedUnion("source", [requestValue, observationValue, contractConstant]);
export type PrimitiveValueRef = z.infer<typeof PrimitiveValueRefSchema>;

const handleRef = z.object({ source: z.literal("handle"), handle: identifier }).strict();
export const EntityRefSchema = z.union([requestValue, observationValue, handleRef]);
export type EntityRef = z.infer<typeof EntityRefSchema>;

const command = <TOp extends string, T extends z.ZodRawShape>(op: TOp, args: T) => z.object({
  op: z.literal(op), commandId: identifier, usesHandles: z.array(identifier).max(16),
  createsHandle: identifier.optional(), args: z.object(args).strict(),
}).strict();
const propertyWrite = z.object({ property: contractConstant, value: PrimitiveValueRefSchema }).strict();

const sceneReadNode = command("scene.readNode", { target: EntityRefSchema });
const sceneReadComponent = command("scene.readComponent", { target: EntityRefSchema, componentType: contractConstant });
const sceneReadProperties = command("scene.readProperties", { target: EntityRefSchema, properties: z.array(contractConstant).min(1).max(64) });
const sceneCreateNode = command("scene.createNode", { parent: EntityRefSchema.optional(), name: PrimitiveValueRefSchema });
const sceneCreatePrimitive = command("scene.createPrimitive", { parent: EntityRefSchema.optional(), primitive: contractConstant, name: PrimitiveValueRefSchema.optional() });
const sceneAddComponent = command("scene.addComponent", { target: EntityRefSchema, componentType: contractConstant });
const sceneRemoveComponent = command("scene.removeComponent", { target: EntityRefSchema, componentType: contractConstant });
const sceneSetProperties = command("scene.setProperties", { target: EntityRefSchema, values: z.array(propertyWrite).min(1).max(64) });
const sceneOperateNode = command("scene.operateNode", { target: EntityRefSchema, action: z.enum(["delete", "duplicate", "move", "reset", "apply-prefab", "unlink-prefab"]), destination: EntityRefSchema.optional() });
const assetQuery = command("asset.query", { query: PrimitiveValueRefSchema });
const assetCreate = command("asset.create", { assetPath: PrimitiveValueRefSchema, preset: z.enum(["folder", "material", "scene", "prefab", "animation-clip", "render-texture", "physics-material", "animation-graph", "animation-mask", "auto-atlas", "terrain"]) });
const assetOperate = command("asset.operate", { target: EntityRefSchema, action: z.enum(["move", "copy", "delete", "open", "refresh", "reimport"]), destination: PrimitiveValueRefSchema.optional() });
const projectReadSetting = command("project.readSetting", { namespace: contractConstant, key: contractConstant });
const projectWriteSetting = command("project.writeSetting", { namespace: contractConstant, key: contractConstant, value: PrimitiveValueRefSchema });
const editorSelection = command("editor.selection", { action: z.enum(["get", "set", "clear"]), targets: z.array(EntityRefSchema).max(256).optional() });
const editorViewport = command("editor.viewport", { action: z.enum(["focus", "frame", "refresh"]), target: EntityRefSchema.optional() });
const editorHistory = command("editor.history", { action: z.enum(["undo", "redo", "abort"]) });
const animationQuery = command("animation.query", { target: EntityRefSchema, query: contractConstant });
const animationEdit = command("animation.edit", { target: EntityRefSchema, action: contractConstant, values: z.array(propertyWrite).max(64) });
const buildQuery = command("build.query", { query: z.enum(["tasks", "task"]), taskId: PrimitiveValueRefSchema.optional() });
const buildStart = command("build.start", { options: PrimitiveValueRefSchema });
const buildControl = command("build.control", { taskId: PrimitiveValueRefSchema, action: z.enum(["break", "remove", "recompile"]) });
const runtimeControl = command("runtime.control", { action: z.enum(["pause", "resume", "set-time-scale", "get-state"]), value: PrimitiveValueRefSchema.optional() });
const previewCapture = command("preview.capture", { target: EntityRefSchema, width: PrimitiveValueRefSchema, height: PrimitiveValueRefSchema, quality: PrimitiveValueRefSchema });
const screenshotCapture = command("screenshot.capture", { width: PrimitiveValueRefSchema, height: PrimitiveValueRefSchema, quality: PrimitiveValueRefSchema, camera: EntityRefSchema.optional() });

export const PrimitiveCommandSchema = z.discriminatedUnion("op", [
  sceneReadNode, sceneReadComponent, sceneReadProperties, sceneCreateNode, sceneCreatePrimitive,
  sceneAddComponent, sceneRemoveComponent, sceneSetProperties, sceneOperateNode, assetQuery,
  assetCreate, assetOperate, projectReadSetting, projectWriteSetting, editorSelection, editorViewport,
  editorHistory, animationQuery, animationEdit, buildQuery, buildStart, buildControl, runtimeControl,
  previewCapture, screenshotCapture,
]);
export type PrimitiveCommand = z.infer<typeof PrimitiveCommandSchema>;

type CommandSemantics = { effect: Effect; createsHandle: boolean; ipcCount: number };
const fixedSemantics: Record<string, CommandSemantics> = {
  "scene.readNode": { effect: "none", createsHandle: false, ipcCount: 1 },
  "scene.readComponent": { effect: "none", createsHandle: false, ipcCount: 1 },
  "scene.readProperties": { effect: "none", createsHandle: false, ipcCount: 1 },
  "scene.createNode": { effect: "project-write", createsHandle: true, ipcCount: 1 },
  "scene.createPrimitive": { effect: "project-write", createsHandle: true, ipcCount: 1 },
  "scene.addComponent": { effect: "project-write", createsHandle: true, ipcCount: 1 },
  "scene.removeComponent": { effect: "project-write", createsHandle: false, ipcCount: 1 },
  "scene.setProperties": { effect: "project-write", createsHandle: false, ipcCount: 1 },
  "asset.query": { effect: "none", createsHandle: false, ipcCount: 1 },
  "asset.create": { effect: "project-write", createsHandle: true, ipcCount: 1 },
  "project.readSetting": { effect: "none", createsHandle: false, ipcCount: 1 },
  "project.writeSetting": { effect: "project-write", createsHandle: false, ipcCount: 1 },
  "editor.viewport": { effect: "local-state", createsHandle: false, ipcCount: 1 },
  "editor.history": { effect: "project-write", createsHandle: false, ipcCount: 1 },
  "animation.query": { effect: "none", createsHandle: false, ipcCount: 1 },
  "animation.edit": { effect: "project-write", createsHandle: false, ipcCount: 1 },
  "build.query": { effect: "none", createsHandle: false, ipcCount: 1 },
  "build.start": { effect: "external-side-effect", createsHandle: false, ipcCount: 1 },
  "build.control": { effect: "external-side-effect", createsHandle: false, ipcCount: 1 },
  "preview.capture": { effect: "none", createsHandle: false, ipcCount: 1 },
  "screenshot.capture": { effect: "none", createsHandle: false, ipcCount: 1 },
};

export function primitiveCommandSemantics(command: PrimitiveCommand): CommandSemantics {
  if (command.op === "scene.operateNode") return { effect: "project-write", createsHandle: command.args.action === "duplicate", ipcCount: 1 };
  if (command.op === "asset.operate") return { effect: ["open", "refresh"].includes(command.args.action) ? "local-state" : "project-write", createsHandle: command.args.action === "copy", ipcCount: 1 };
  if (command.op === "editor.selection") return { effect: command.args.action === "get" ? "none" : "local-state", createsHandle: false, ipcCount: 1 };
  if (command.op === "runtime.control") return { effect: command.args.action === "get-state" ? "none" : "local-state", createsHandle: false, ipcCount: 1 };
  const semantics = fixedSemantics[command.op];
  if (!semantics) throw new Error(`missing primitive semantics: ${command.op}`);
  return semantics;
}

const effectRank: Record<Effect, number> = { none: 0, "local-state": 1, "project-write": 2, "external-side-effect": 3 };
function referencedHandles(value: unknown, found = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return found;
  if (!Array.isArray(value) && "source" in value && value.source === "handle" && "handle" in value && typeof value.handle === "string") found.add(value.handle);
  for (const child of Object.values(value)) referencedHandles(child, found);
  return found;
}

const precondition = z.object({ kind: z.enum(["observation", "entity", "lifecycle", "build-task"]), target: z.union([requestValue, observationValue]).optional(), revisionToken: z.string().min(1).max(512), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const ExecutionEnvelopeSchema = z.object({
  effect: EffectSchema,
  commands: z.array(PrimitiveCommandSchema).min(1).max(64),
  preconditions: z.array(precondition).max(128),
  transaction: z.object({ mode: z.enum(["read", "ordered-effect"]), onError: z.literal("stop"), snapshot: z.enum(["none", "once-after-success", "once-after-partial-failure"]) }).strict(),
  return: z.discriminatedUnion("mode", [z.object({ mode: z.literal("command-result"), commandId: identifier }).strict(), z.object({ mode: z.literal("execution-summary") }).strict()]),
  limits: z.object({ commandCount: z.number().int().min(1).max(64), ipcCount: z.number().int().min(0).max(128), inputBytes: z.number().int().min(0).max(262144), outputBytes: z.number().int().min(0).max(524288), timeoutMs: z.number().int().min(1).max(15000) }).strict(),
}).strict().superRefine((envelope, context) => {
  const issue = (message: string, path: (string | number)[]) => context.addIssue({ code: z.ZodIssueCode.custom, message, path });
  if (envelope.commands.length !== envelope.limits.commandCount) issue("commandCount mismatch", ["limits", "commandCount"]);
  const commandIds = new Set<string>();
  const handles = new Set<string>();
  const commandEffects = new Set<Effect>();
  let requiredEffectRank = 0;
  let requiredIpc = envelope.transaction.snapshot === "none" ? 0 : 1;
  envelope.commands.forEach((entry, index) => {
    const semantics = primitiveCommandSemantics(entry);
    commandEffects.add(semantics.effect);
    requiredEffectRank = Math.max(requiredEffectRank, effectRank[semantics.effect]);
    requiredIpc += semantics.ipcCount;
    if (commandIds.has(entry.commandId)) issue("duplicate commandId", ["commands", index, "commandId"]);
    commandIds.add(entry.commandId);
    const refs = [...referencedHandles(entry.args)].sort();
    const declared = [...entry.usesHandles].sort();
    if (new Set(entry.usesHandles).size !== entry.usesHandles.length || refs.join("\0") !== declared.join("\0")) issue("usesHandles mismatch", ["commands", index, "usesHandles"]);
    for (const handle of refs) if (!handles.has(handle)) issue("handle must be created by an earlier command", ["commands", index, "usesHandles"]);
    if (entry.op === "scene.operateNode" && entry.args.action === "move" && entry.args.destination === undefined) {
      issue("move requires destination", ["commands", index, "args", "destination"]);
    }
    if (entry.op === "asset.operate" && (entry.args.action === "move" || entry.args.action === "copy") && entry.args.destination === undefined) {
      issue("asset relocate requires destination", ["commands", index, "args", "destination"]);
    }
    if (entry.op === "editor.selection" && entry.args.action === "set" && (!entry.args.targets || entry.args.targets.length === 0)) {
      issue("selection set requires targets", ["commands", index, "args", "targets"]);
    }
    if (entry.op === "build.control" && entry.args.taskId === undefined) {
      issue("build control requires taskId", ["commands", index, "args", "taskId"]);
    }
    if (entry.op === "runtime.control" && entry.args.action === "set-time-scale" && entry.args.value === undefined) {
      issue("set-time-scale requires value", ["commands", index, "args", "value"]);
    }
    if (semantics.createsHandle !== Boolean(entry.createsHandle)) issue(semantics.createsHandle ? "createsHandle required" : "createsHandle forbidden", ["commands", index, "createsHandle"]);
    if (entry.createsHandle) {
      if (handles.has(entry.createsHandle)) issue("duplicate createsHandle", ["commands", index, "createsHandle"]);
      handles.add(entry.createsHandle);
    }
  });
  if (commandEffects.size !== 1) issue("mixed command effects forbidden", ["commands"]);
  const requiredEffect = (["none", "local-state", "project-write", "external-side-effect"] as const)[requiredEffectRank];
  if (envelope.effect !== requiredEffect) issue(`effect must be ${requiredEffect}`, ["effect"]);
  if (requiredEffect === "none" && envelope.transaction.mode !== "read") issue("none effect requires read transaction", ["transaction", "mode"]);
  if (requiredEffect !== "none" && envelope.transaction.mode !== "ordered-effect") issue("effect requires ordered transaction", ["transaction", "mode"]);
  if (requiredEffect !== "none" && envelope.preconditions.length === 0) issue("effect requires preconditions", ["preconditions"]);
  if (requiredEffect === "none" && envelope.transaction.snapshot !== "none") issue("read transaction cannot snapshot", ["transaction", "snapshot"]);
  if (requiredEffect === "project-write" && envelope.transaction.snapshot === "none") issue("project write requires snapshot", ["transaction", "snapshot"]);
  if (requiredEffect !== "project-write" && envelope.transaction.snapshot !== "none") issue("snapshot only valid for project write", ["transaction", "snapshot"]);
  if (envelope.limits.ipcCount !== requiredIpc) issue("ipcCount mismatch", ["limits", "ipcCount"]);
  if (envelope.return.mode === "command-result" && !commandIds.has(envelope.return.commandId)) issue("return commandId missing", ["return", "commandId"]);
});
export type ExecutionEnvelope = z.infer<typeof ExecutionEnvelopeSchema>;
