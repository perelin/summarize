import { parseAccountsConfig } from "./config/accounts.js";
import { readParsedConfigFile, resolveSummarizeConfigPath } from "./config/read.js";
import {
  parseApiKeysConfig,
  parseCacheConfig,
  parseEnvConfig,
  parseLiteLlmConfig,
  parseLoggingConfig,
  parseMediaConfig,
  parseOutputConfig,
} from "./config/sections.js";
import type { SummarizeConfig } from "./config/types.js";

export type {
  Account,
  ApiKeysConfig,
  EnvConfig,
  LiteLlmConfig,
  LoggingConfig,
  LoggingFormat,
  LoggingLevel,
  MediaCacheConfig,
  MediaCacheVerifyMode,
  SummarizeConfig,
  VideoMode,
} from "./config/types.js";

export { mergeConfigEnv, resolveConfigEnv } from "./config/env.js";

export function loadSummarizeConfig({
  env,
  cwd,
}: {
  env: Record<string, string | undefined>;
  cwd?: string;
}): {
  config: SummarizeConfig | null;
  path: string | null;
} {
  const path = resolveSummarizeConfigPath(env, cwd);
  if (!path) return { config: null, path: null };
  const parsed = readParsedConfigFile(path);
  if (!parsed) return { config: null, path };

  const model = (() => {
    const value = (parsed as Record<string, unknown>).model;
    if (typeof value === "undefined") return undefined;
    if (typeof value !== "string") {
      throw new Error(`Invalid config file ${path}: "model" must be a string.`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`Invalid config file ${path}: "model" must not be empty.`);
    }
    return trimmed;
  })();

  const sttModel = (() => {
    const value = (parsed as Record<string, unknown>).sttModel;
    if (typeof value === "undefined") return undefined;
    if (typeof value !== "string") {
      throw new Error(`Invalid config file ${path}: "sttModel" must be a string.`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`Invalid config file ${path}: "sttModel" must not be empty.`);
    }
    return trimmed;
  })();

  const language = (() => {
    const value = parsed.language;
    if (typeof value === "undefined") return undefined;
    if (typeof value !== "string") {
      throw new Error(`Invalid config file ${path}: "language" must be a string.`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`Invalid config file ${path}: "language" must not be empty.`);
    }
    return trimmed;
  })();

  const prompt = (() => {
    const value = (parsed as Record<string, unknown>).prompt;
    if (typeof value === "undefined") return undefined;
    if (typeof value !== "string") {
      throw new Error(`Invalid config file ${path}: "prompt" must be a string.`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`Invalid config file ${path}: "prompt" must not be empty.`);
    }
    return trimmed;
  })();

  const litellm = parseLiteLlmConfig(parsed, path);
  const cache = parseCacheConfig(parsed, path);
  const media = parseMediaConfig(parsed);
  const output = parseOutputConfig(parsed, path);
  const logging = parseLoggingConfig(parsed, path);

  const configEnv = parseEnvConfig(parsed, path);
  const apiKeys = parseApiKeysConfig(parsed, path);
  const accounts = parseAccountsConfig(parsed.accounts, path);

  return {
    config: {
      ...(model ? { model } : {}),
      ...(sttModel ? { sttModel } : {}),
      ...(language ? { language } : {}),
      ...(prompt ? { prompt } : {}),
      ...(litellm ? { litellm } : {}),
      ...(cache ? { cache } : {}),
      ...(media ? { media } : {}),
      ...(output ? { output } : {}),
      ...(logging ? { logging } : {}),
      ...(configEnv ? { env: configEnv } : {}),
      ...(apiKeys ? { apiKeys } : {}),
      ...(accounts ? { accounts } : {}),
    },
    path,
  };
}
