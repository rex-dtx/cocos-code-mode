import { CcbError } from "./errors";
import type { PrimitiveCommand } from "./primitive-contract";

export type CreatorChannel = (message: string, args: Record<string, unknown>) => Promise<unknown>;

export function createCreatorAdapters(channel: CreatorChannel) {
  return async function invoke(command: PrimitiveCommand): Promise<unknown> {
    switch (command.op) {
      case "scene.readNode":
      case "scene.readComponent":
      case "scene.readProperties":
      case "scene.createNode":
      case "scene.createPrimitive":
      case "scene.addComponent":
      case "scene.removeComponent":
      case "scene.setProperties":
      case "scene.operateNode":
        return channel("scene", { op: command.op, args: command.args, createsHandle: command.createsHandle });
      case "asset.query":
      case "asset.create":
      case "asset.operate":
        return channel("asset", { op: command.op, args: command.args, createsHandle: command.createsHandle });
      case "project.readSetting":
      case "project.writeSetting":
        return channel("project", { op: command.op, args: command.args });
      case "editor.selection":
      case "editor.viewport":
      case "editor.history":
        return channel("editor", { op: command.op, args: command.args });
      case "animation.query":
      case "animation.edit":
        return channel("animation", { op: command.op, args: command.args });
      case "build.query":
      case "build.start":
      case "build.control":
        return channel("build", { op: command.op, args: command.args });
      case "runtime.control":
        return channel("runtime", { op: command.op, args: command.args });
      case "preview.capture":
        return channel("preview", { op: command.op, args: command.args });
      case "screenshot.capture":
        return channel("screenshot", { op: command.op, args: command.args });
      default: {
        const exhaustive: never = command;
        throw new CcbError("CCB_PRIMITIVE_UNKNOWN", "Relay has no adapter for this primitive.", { op: String(exhaustive) });
      }
    }
  };
}
