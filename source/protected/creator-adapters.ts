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
      case "scene.readNode":
      case "scene.readComponent":
      case "scene.readProperties":
      case "scene.createPrimitive":
      case "scene.addComponent":
      case "scene.removeComponent":
      case "scene.setProperties":
      case "scene.operateNode":
      case "asset.query":
      case "asset.create":
      case "asset.operate":
      case "project.readSetting":
      case "project.writeSetting":
      case "editor.selection":
      case "editor.viewport":
      case "editor.history":
      case "animation.query":
      case "animation.edit":
      case "build.query":
      case "build.start":
      case "build.control":
      case "runtime.control":
      case "preview.capture":
      case "screenshot.capture":
        throw new CcbError("CCB_PRIMITIVE_UNKNOWN", "This primitive has no Creator adapter in v1.", { op: command.op });
      default: {
        const exhaustive: never = command;
        throw new CcbError("CCB_PRIMITIVE_UNKNOWN", "Relay has no adapter for this primitive.", { op: String(exhaustive) });
      }
    }
  };
}
