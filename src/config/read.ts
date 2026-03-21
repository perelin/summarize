import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSON5 from "json5";
import { resolveDataDir } from "./data-dir.js";
import { isRecord } from "./parse-helpers.js";

/**
 * Resolve the config file path. Search order:
 *  1. `SUMMARIZE_CONFIG` env var (explicit override)
 *  2. `<cwd>/config.json` (project-local, when `cwd` is provided)
 *  3. `<SUMMARIZE_DATA_DIR>/config.json` (data-dir convention)
 */
export function resolveSummarizeConfigPath(
  env: Record<string, string | undefined>,
  cwd?: string,
): string | null {
  // 1. Explicit env var override
  const explicit = env.SUMMARIZE_CONFIG?.trim();
  if (explicit) return explicit;

  // 2. CWD config.json (project-local)
  if (cwd) {
    const local = join(cwd, "config.json");
    try {
      readFileSync(local, "utf8");
      return local;
    } catch {
      // not found, fall through
    }
  }

  // 3. SUMMARIZE_DATA_DIR/config.json
  const dataDir = resolveDataDir(env);
  if (dataDir) {
    const dataConfig = join(dataDir, "config.json");
    try {
      readFileSync(dataConfig, "utf8");
      return dataConfig;
    } catch {
      // not found
    }
  }

  return null;
}

function assertNoComments(raw: string, path: string): void {
  let inString: '"' | "'" | null = null;
  let escaped = false;
  let line = 1;
  let col = 1;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] ?? "";
    const next = raw[i + 1] ?? "";

    if (inString) {
      if (escaped) {
        escaped = false;
        col += 1;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        col += 1;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      if (ch === "\n") {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch as '"' | "'";
      escaped = false;
      col += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      throw new Error(
        `Invalid config file ${path}: comments are not allowed (found // at ${line}:${col}).`,
      );
    }

    if (ch === "/" && next === "*") {
      throw new Error(
        `Invalid config file ${path}: comments are not allowed (found /* at ${line}:${col}).`,
      );
    }

    if (ch === "\n") {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
}

export function readParsedConfigFile(path: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  assertNoComments(raw, path);
  try {
    parsed = JSON5.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in config file ${path}: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Invalid config file ${path}: expected an object at the top level`);
  }

  return parsed;
}
