import { URL } from "node:url";

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
