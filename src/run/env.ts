import { accessSync, constants as fsConstants } from "node:fs";
import path from "node:path";

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveExecutableInPath(
  binary: string,
  env: Record<string, string | undefined>,
): string | null {
  if (!binary) return null;
  if (path.isAbsolute(binary)) {
    return isExecutable(binary) ? binary : null;
  }
  const pathEnv = env.PATH ?? "";
  for (const entry of pathEnv.split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, binary);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

export function hasBirdCli(env: Record<string, string | undefined>): boolean {
  return resolveExecutableInPath("bird", env) !== null;
}

export function hasXurlCli(env: Record<string, string | undefined>): boolean {
  return resolveExecutableInPath("xurl", env) !== null;
}

export function hasUvxCli(env: Record<string, string | undefined>): boolean {
  if (typeof env.UVX_PATH === "string" && env.UVX_PATH.trim().length > 0) {
    return true;
  }
  return resolveExecutableInPath("uvx", env) !== null;
}

export function parseBooleanEnv(value: string | null | undefined): boolean | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}
