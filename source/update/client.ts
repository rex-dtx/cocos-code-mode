import { URL } from "node:url";

export const MAX_RELEASE_BYTES = 64 * 1024 * 1024;

export function assertReleaseOrigin(origin: string): URL {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("release origin must be an exact HTTPS origin without credentials, query, or fragment");
  }
  return url;
}

export function assertReleaseArtifactUrl(origin: URL, artifactUrl: string): URL {
  const url = new URL(artifactUrl);
  if (url.origin !== origin.origin || url.protocol !== "https:" || url.username || url.password) {
    throw new Error("release artifact URL must stay on the HTTPS release origin");
  }
  return url;
}

export async function fetchReleaseArtifact(
  origin: string,
  artifactUrl: string,
  maxBytes = MAX_RELEASE_BYTES,
): Promise<Buffer> {
  const url = assertReleaseArtifactUrl(assertReleaseOrigin(origin), artifactUrl);
  const response = await fetch(url, { method: "GET", redirect: "error" });
  if (!response.ok) throw new Error(`release artifact HTTP ${response.status}`);
  const declared = response.headers.get("content-length");
  if (declared === null) throw new Error("release artifact must declare Content-Length");
  const size = Number(declared);
  if (!Number.isInteger(size) || size <= 0 || size > maxBytes) {
    throw new Error("release artifact Content-Length exceeds the download cap");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== size) throw new Error("release artifact size does not match Content-Length");
  return bytes;
}
