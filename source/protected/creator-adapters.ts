import { CcbError } from "./errors";
import type { PrimitiveCommand } from "./primitive-contract";

export type CreatorChannel = (module: string, message: string, args: Record<string, unknown>) => Promise<unknown>;

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", `${label} must be a string.`);
  return value;
}

export function createCreatorAdapters(channel: CreatorChannel) {
  return async function invoke(command: PrimitiveCommand): Promise<unknown> {
    switch (command.op) {
      case "scene.createNode": {
        const args = command.args as unknown as { name?: unknown; parent?: unknown };
        return channel("scene", "create-node", {
          name: text(args.name, "node name"),
          ...(typeof args.parent === "string" ? { parent: args.parent } : {}),
        });
      }
      case "screenshot.capture": {
        const args = command.args as unknown as { width?: unknown; height?: unknown; quality?: unknown };
        return channel("scene", "capture-screenshot", {
          width: args.width,
          height: args.height,
          quality: args.quality,
        });
      }
      case "scene.readNode": {
        const args = command.args as unknown as { target?: unknown };
        const target = args.target;
        const uuid = typeof target === "string" ? target : target && typeof target === "object" && "handle" in target ? undefined : target;
        return channel("scene", "query-node", { uuid });
      }
      case "editor.history": {
        const args = command.args as unknown as { action?: unknown };
        const action = text(args.action, "history action");
        return channel("scene", action === "undo" ? "undo" : action === "redo" ? "redo" : "snapshot", {});
      }
      case "scene.setProperties": {
        const args = command.args as unknown as { target?: unknown; values?: unknown };
        return channel("scene", "set-property", { target: args.target, values: args.values });
      }
      case "scene.addComponent": {
        const args = command.args as unknown as { target?: unknown; componentType?: unknown };
        return channel("scene", "create-component", { target: args.target, component: args.componentType });
      }
      case "runtime.control": {
        const args = command.args as unknown as { action?: unknown; value?: unknown };
        const action = text(args.action, "runtime action");
        if (action === "pause") return channel("scene", "pause", {});
        if (action === "resume") return channel("scene", "resume", {});
        if (action === "get-state") return channel("scene", "query-runtime", {});
        return channel("scene", "set-time-scale", { value: args.value });
      }
      case "scene.operateNode": {
        const args = command.args as unknown as { target?: unknown; action?: unknown; destination?: unknown };
        return channel("scene", "operate-node", { target: args.target, action: args.action, destination: args.destination });
      }
      case "asset.query": {
        const args = command.args as unknown as { query?: unknown };
        return channel("asset-db", "query-assets", { query: args.query });
      }
      case "editor.selection": {
        const args = command.args as unknown as { action?: unknown; targets?: unknown };
        const action = text(args.action, "selection action");
        if (action === "get") return channel("scene", "query-selection", {});
        if (action === "clear") return channel("selection", "clear", {});
        return channel("selection", "select", { targets: args.targets });
      }
      case "editor.viewport": {
        const args = command.args as unknown as { action?: unknown; target?: unknown };
        return channel("scene", "focus-node", { action: args.action, target: args.target });
      }
      case "scene.readComponent": {
        const args = command.args as unknown as { target?: unknown; componentType?: unknown };
        return channel("scene", "query-component", { target: args.target, component: args.componentType });
      }
      case "scene.readProperties": {
        const args = command.args as unknown as { target?: unknown; properties?: unknown };
        return channel("scene", "query-property", { target: args.target, properties: args.properties });
      }
      case "scene.createPrimitive": {
        const args = command.args as unknown as { parent?: unknown; primitive?: unknown; name?: unknown };
        return channel("scene", "create-node", { parent: args.parent, name: args.name, primitive: args.primitive });
      }
      case "scene.removeComponent": {
        const args = command.args as unknown as { target?: unknown; componentType?: unknown };
        return channel("scene", "remove-component", { target: args.target, component: args.componentType });
      }
      case "asset.operate": {
        const args = command.args as unknown as { target?: unknown; action?: unknown; destination?: unknown };
        return channel("asset-db", String(args.action ?? "query-asset"), { target: args.target, destination: args.destination });
      }
      case "project.readSetting": {
        const args = command.args as unknown as { namespace?: unknown; key?: unknown };
        return channel("project", "get-config", { namespace: args.namespace, key: args.key });
      }
      case "project.writeSetting": {
        const args = command.args as unknown as { namespace?: unknown; key?: unknown; value?: unknown };
        return channel("project", "set-config", { namespace: args.namespace, key: args.key, value: args.value });
      }
      case "animation.query": {
        const args = command.args as unknown as { target?: unknown; query?: unknown };
        return channel("scene", "query-animation", { target: args.target, query: args.query });
      }
      case "animation.edit": {
        const args = command.args as unknown as { target?: unknown; action?: unknown; values?: unknown };
        return channel("scene", "edit-animation", { target: args.target, action: args.action, values: args.values });
      }
      case "build.query": {
        const args = command.args as unknown as { query?: unknown; taskId?: unknown };
        return channel("builder", "query-tasks", { query: args.query, taskId: args.taskId });
      }
      case "build.start": {
        const args = command.args as unknown as { options?: unknown };
        return channel("builder", "start-task", { options: args.options });
      }
      case "build.control": {
        const args = command.args as unknown as { taskId?: unknown; action?: unknown };
        return channel("builder", String(args.action ?? "query"), { taskId: args.taskId });
      }
      case "preview.capture": {
        const args = command.args as unknown as { target?: unknown; width?: unknown; height?: unknown; quality?: unknown };
        return channel("preview", "capture", { target: args.target, width: args.width, height: args.height, quality: args.quality });
      }
      case "asset.create": {
        const args = command.args as unknown as { assetPath?: unknown; preset?: unknown };
        return channel("asset-db", "create-asset", { path: args.assetPath, preset: args.preset });
      }
      default: {
        const exhaustive: never = command;
        throw new CcbError("CCB_PRIMITIVE_UNKNOWN", "Relay has no adapter for this primitive.", { op: String(exhaustive) });
      }
    }
  };
}
