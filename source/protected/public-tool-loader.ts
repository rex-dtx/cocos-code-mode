import { z } from "zod";

const PublicToolSchema = z.object({
  name: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  contractVersion: z.number().int().min(1),
  contractHash: z.string().regex(/^[a-f0-9]{64}$/),
  observation: z.object({
    contractId: z.string().min(1).max(128),
    consentVersion: z.string().min(1).max(128),
    fields: z.array(z.string().min(1).max(64)).max(32),
  }).strict(),
}).strict();

export const PublicToolManifestSchema = z.object({
  schemaVersion: z.literal(1),
  tools: z.array(PublicToolSchema).min(1).max(128),
}).strict();

export type PublicToolManifest = z.infer<typeof PublicToolManifestSchema>;
export type PublicToolContract = z.infer<typeof PublicToolSchema>;

export function loadPublicToolManifest(value: unknown): PublicToolManifest {
  const manifest = PublicToolManifestSchema.parse(value);
  const names = manifest.tools.map((tool) => tool.name);
  if (new Set(names).size !== names.length) throw new Error("public tool manifest has duplicate names");
  return manifest;
}

export function findPublicTool(manifest: PublicToolManifest, name: string): PublicToolContract {
  const tool = manifest.tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`unknown public protected tool: ${name}`);
  return tool;
}
