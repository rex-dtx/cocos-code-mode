import {
  chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, renameSync, unlinkSync, writeSync,
} from "fs";
import { homedir } from "os";
import { dirname, resolve, sep } from "path";

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

function assertInsideUserHome(path: string): void {
  const home = resolve(homedir());
  const candidate = resolve(path);
  if (candidate !== home && !candidate.startsWith(`${home}${sep}`)) {
    throw new Error("protected relay state must be stored inside the current user's home directory");
  }
}

function assertNotSymlink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`refusing symbolic link for protected relay state: ${path}`);
  }
}

function assertPrivatePermissions(path: string, directory: boolean): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`refusing symbolic link for protected relay state: ${path}`);
  if (process.platform === "win32") return;
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error(`protected relay state is not owned by the current user: ${path}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`protected relay state permissions are not user-only: ${path}`);
  }
  if (directory !== stat.isDirectory()) {
    throw new Error(`protected relay state has the wrong file type: ${path}`);
  }
}

export function ensurePrivateDirectory(path: string): void {
  assertInsideUserHome(path);
  assertNotSymlink(path);
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  if (process.platform !== "win32") {
    chmodSync(path, PRIVATE_DIRECTORY_MODE);
    assertPrivatePermissions(path, true);
  }
}

export function readPrivateJson(path: string, maxBytes: number): unknown | undefined {
  assertInsideUserHome(path);
  if (!existsSync(path)) return undefined;
  assertPrivatePermissions(path, false);
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new RangeError(`protected relay state must contain 1..${maxBytes} bytes`);
  }
  return JSON.parse(bytes.toString("utf8"));
}

export function writePrivateJsonAtomic(path: string, value: unknown): void {
  assertInsideUserHome(path);
  const directory = dirname(path);
  ensurePrivateDirectory(directory);
  assertNotSymlink(path);

  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", PRIVATE_FILE_MODE);
    writeSync(descriptor, bytes, 0, bytes.length, 0);
    try { fsyncSync(descriptor); } catch (error: any) {
      if (!["EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)) throw error;
    }
    closeSync(descriptor);
    descriptor = undefined;
    if (process.platform !== "win32") {
      chmodSync(temporary, PRIVATE_FILE_MODE);
    }
    renameSync(temporary, path);
    if (process.platform !== "win32") {
      assertPrivatePermissions(path, false);
    }

    try {
      const directoryDescriptor = openSync(directory, "r");
      try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
    } catch (error: any) {
      if (!["EINVAL", "ENOTSUP", "EPERM", "EISDIR"].includes(error?.code)) throw error;
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
