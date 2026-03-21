import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModelConfig } from "./model.js";
import { isRecord } from "./parse-helpers.js";
import type { AutoRule, ModelConfig } from "./types.js";

const CONFIG_FILENAME = "config/default-models.json";
const LABEL = CONFIG_FILENAME;

let cached: { defaultRules: AutoRule[]; builtinModels: Record<string, ModelConfig> } | null = null;

function findProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    try {
      readFileSync(join(dir, "package.json"), "utf8");
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("Could not find project root (no package.json found above config loader)");
}

function load(): { defaultRules: AutoRule[]; builtinModels: Record<string, ModelConfig> } {
  if (cached) return cached;

  const root = findProjectRoot();
  const filePath = join(root, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(
      `Missing ${filePath} — this file is required for model auto-selection defaults.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${filePath}: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Invalid ${LABEL}: expected an object at the top level`);
  }

  const defaultRules = parseDefaultRules(parsed);
  const builtinModels = parseBuiltinModels(parsed);

  cached = { defaultRules, builtinModels };
  return cached;
}

function parseDefaultRules(parsed: Record<string, unknown>): AutoRule[] {
  const raw = parsed.defaultRules;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Invalid ${LABEL}: "defaultRules" must be a non-empty array.`);
  }

  // Reuse the existing auto-rule model config parser by wrapping rules in a
  // ModelConfig shape ({ mode: "auto", rules: [...] }) and extracting the result.
  const modelConfig = parseModelConfig({ mode: "auto", rules: raw }, LABEL, "defaultRules");
  if (!modelConfig || !("mode" in modelConfig) || modelConfig.mode !== "auto") {
    throw new Error(
      `Invalid ${LABEL}: "defaultRules" could not be parsed as auto-selection rules.`,
    );
  }
  if (!modelConfig.rules || modelConfig.rules.length === 0) {
    throw new Error(`Invalid ${LABEL}: "defaultRules" produced no valid rules.`);
  }
  return modelConfig.rules;
}

function parseBuiltinModels(parsed: Record<string, unknown>): Record<string, ModelConfig> {
  const raw = parsed.builtinModels;
  if (typeof raw === "undefined") return {};
  if (!isRecord(raw)) {
    throw new Error(`Invalid ${LABEL}: "builtinModels" must be an object.`);
  }

  const out: Record<string, ModelConfig> = {};
  for (const [name, value] of Object.entries(raw)) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const model = parseModelConfig(value, LABEL, `builtinModels.${trimmed}`);
    if (model) out[trimmed] = model;
  }
  return out;
}

export function getDefaultAutoRules(): AutoRule[] {
  return load().defaultRules;
}

export function getBuiltinModels(): Record<string, ModelConfig> {
  return load().builtinModels;
}
