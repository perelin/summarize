import {
  isRecord,
  parseLoggingFormat,
  parseLoggingLevel,
  parseOptionalBaseUrl,
} from "./parse-helpers.js";
import type {
  ApiKeysConfig,
  EnvConfig,
  LoggingConfig,
  MediaCacheConfig,
  MediaCacheVerifyMode,
  OpenAiConfig,
  VideoMode,
} from "./types.js";

export function parseProviderBaseUrlConfig(
  raw: unknown,
  path: string,
  providerName: string,
): { baseUrl: string } | undefined {
  if (typeof raw === "undefined") return undefined;
  if (!isRecord(raw)) {
    throw new Error(`Invalid config file ${path}: "${providerName}" must be an object.`);
  }
  const baseUrl = parseOptionalBaseUrl(raw.baseUrl);
  return typeof baseUrl === "string" ? { baseUrl } : undefined;
}

function parseMediaCacheConfig(raw: unknown, path: string): MediaCacheConfig | undefined {
  if (typeof raw === "undefined") return undefined;
  if (!isRecord(raw)) {
    throw new Error(`Invalid config file ${path}: "cache.media" must be an object.`);
  }
  const mediaEnabled = typeof raw.enabled === "boolean" ? raw.enabled : undefined;
  const mediaMaxRaw = raw.maxMb;
  const mediaMaxMb =
    typeof mediaMaxRaw === "number" && Number.isFinite(mediaMaxRaw) && mediaMaxRaw > 0
      ? mediaMaxRaw
      : typeof mediaMaxRaw === "undefined"
        ? undefined
        : (() => {
            throw new Error(`Invalid config file ${path}: "cache.media.maxMb" must be a number.`);
          })();
  const mediaTtlRaw = raw.ttlDays;
  const mediaTtlDays =
    typeof mediaTtlRaw === "number" && Number.isFinite(mediaTtlRaw) && mediaTtlRaw > 0
      ? mediaTtlRaw
      : typeof mediaTtlRaw === "undefined"
        ? undefined
        : (() => {
            throw new Error(`Invalid config file ${path}: "cache.media.ttlDays" must be a number.`);
          })();
  const mediaPath =
    typeof raw.path === "string" && raw.path.trim().length > 0
      ? raw.path.trim()
      : typeof raw.path === "undefined"
        ? undefined
        : (() => {
            throw new Error(`Invalid config file ${path}: "cache.media.path" must be a string.`);
          })();
  const verifyRaw = typeof raw.verify === "string" ? raw.verify.trim().toLowerCase() : "";
  const verify =
    verifyRaw === "none" || verifyRaw === "size" || verifyRaw === "hash"
      ? (verifyRaw as MediaCacheVerifyMode)
      : verifyRaw.length > 0
        ? (() => {
            throw new Error(
              `Invalid config file ${path}: "cache.media.verify" must be one of "none", "size", "hash".`,
            );
          })()
        : undefined;

  return mediaEnabled || mediaMaxMb || mediaTtlDays || mediaPath || typeof verify === "string"
    ? {
        ...(typeof mediaEnabled === "boolean" ? { enabled: mediaEnabled } : {}),
        ...(typeof mediaMaxMb === "number" ? { maxMb: mediaMaxMb } : {}),
        ...(typeof mediaTtlDays === "number" ? { ttlDays: mediaTtlDays } : {}),
        ...(typeof mediaPath === "string" ? { path: mediaPath } : {}),
        ...(typeof verify === "string" ? { verify } : {}),
      }
    : undefined;
}

export function parseCacheConfig(root: Record<string, unknown>, path: string) {
  const value = root.cache;
  if (typeof value === "undefined") return undefined;
  if (!isRecord(value)) {
    throw new Error(`Invalid config file ${path}: "cache" must be an object.`);
  }
  const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined;
  const maxMbRaw = value.maxMb;
  const maxMb =
    typeof maxMbRaw === "number" && Number.isFinite(maxMbRaw) && maxMbRaw > 0
      ? maxMbRaw
      : typeof maxMbRaw === "undefined"
        ? undefined
        : (() => {
            throw new Error(`Invalid config file ${path}: "cache.maxMb" must be a number.`);
          })();
  const ttlDaysRaw = value.ttlDays;
  const ttlDays =
    typeof ttlDaysRaw === "number" && Number.isFinite(ttlDaysRaw) && ttlDaysRaw > 0
      ? ttlDaysRaw
      : typeof ttlDaysRaw === "undefined"
        ? undefined
        : (() => {
            throw new Error(`Invalid config file ${path}: "cache.ttlDays" must be a number.`);
          })();
  const pathValue =
    typeof value.path === "string" && value.path.trim().length > 0
      ? value.path.trim()
      : typeof value.path === "undefined"
        ? undefined
        : (() => {
            throw new Error(`Invalid config file ${path}: "cache.path" must be a string.`);
          })();
  const media = parseMediaCacheConfig(value.media, path);

  return enabled || maxMb || ttlDays || pathValue || media
    ? {
        ...(typeof enabled === "boolean" ? { enabled } : {}),
        ...(typeof maxMb === "number" ? { maxMb } : {}),
        ...(typeof ttlDays === "number" ? { ttlDays } : {}),
        ...(typeof pathValue === "string" ? { path: pathValue } : {}),
        ...(media ? { media } : {}),
      }
    : undefined;
}

export function parseMediaConfig(root: Record<string, unknown>) {
  const value = root.media;
  if (!isRecord(value)) return undefined;
  const videoMode =
    value.videoMode === "auto" ||
    value.videoMode === "transcript" ||
    value.videoMode === "understand"
      ? (value.videoMode as VideoMode)
      : undefined;
  return videoMode ? { videoMode } : undefined;
}

export function parseSlidesConfig(root: Record<string, unknown>, path: string) {
  const value = root.slides;
  if (typeof value === "undefined") return undefined;
  if (!isRecord(value)) {
    throw new Error(`Invalid config file ${path}: "slides" must be an object.`);
  }
  const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined;
  const ocr = typeof value.ocr === "boolean" ? value.ocr : undefined;
  const dir =
    typeof value.dir === "string" && value.dir.trim().length > 0
      ? value.dir.trim()
      : typeof value.dir === "undefined"
        ? undefined
        : (() => {
            throw new Error(`Invalid config file ${path}: "slides.dir" must be a string.`);
          })();
  const sceneRaw = value.sceneThreshold;
  const sceneThreshold =
    typeof sceneRaw === "number" && Number.isFinite(sceneRaw) && sceneRaw >= 0.1 && sceneRaw <= 1
      ? sceneRaw
      : typeof sceneRaw === "undefined"
        ? undefined
        : (() => {
            throw new Error(
              `Invalid config file ${path}: "slides.sceneThreshold" must be a number between 0.1 and 1.0.`,
            );
          })();
  const maxRaw = value.max;
  const max =
    typeof maxRaw === "number" && Number.isFinite(maxRaw) && Number.isInteger(maxRaw) && maxRaw > 0
      ? maxRaw
      : typeof maxRaw === "undefined"
        ? undefined
        : (() => {
            throw new Error(`Invalid config file ${path}: "slides.max" must be an integer.`);
          })();
  const minRaw = value.minDuration;
  const minDuration =
    typeof minRaw === "number" && Number.isFinite(minRaw) && minRaw >= 0
      ? minRaw
      : typeof minRaw === "undefined"
        ? undefined
        : (() => {
            throw new Error(`Invalid config file ${path}: "slides.minDuration" must be a number.`);
          })();
  return enabled ||
    typeof ocr === "boolean" ||
    dir ||
    typeof sceneThreshold === "number" ||
    typeof max === "number" ||
    typeof minDuration === "number"
    ? {
        ...(typeof enabled === "boolean" ? { enabled } : {}),
        ...(typeof ocr === "boolean" ? { ocr } : {}),
        ...(typeof dir === "string" ? { dir } : {}),
        ...(typeof sceneThreshold === "number" ? { sceneThreshold } : {}),
        ...(typeof max === "number" ? { max } : {}),
        ...(typeof minDuration === "number" ? { minDuration } : {}),
      }
    : undefined;
}

export function parseOutputConfig(root: Record<string, unknown>, path: string) {
  const value = root.output;
  if (typeof value === "undefined") return undefined;
  if (!isRecord(value)) {
    throw new Error(`Invalid config file ${path}: "output" must be an object.`);
  }
  const language =
    typeof value.language === "string" && value.language.trim().length > 0
      ? value.language.trim()
      : undefined;
  return typeof language === "string" ? { language } : undefined;
}

export function parseLoggingConfig(
  root: Record<string, unknown>,
  path: string,
): LoggingConfig | undefined {
  const value = root.logging;
  if (typeof value === "undefined") return undefined;
  if (!isRecord(value)) {
    throw new Error(`Invalid config file ${path}: "logging" must be an object.`);
  }
  const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined;
  const level =
    typeof value.level === "undefined" ? undefined : parseLoggingLevel(value.level, path);
  const format =
    typeof value.format === "undefined" ? undefined : parseLoggingFormat(value.format, path);
  const file =
    typeof value.file === "string" && value.file.trim().length > 0
      ? value.file.trim()
      : typeof value.file === "undefined"
        ? undefined
        : (() => {
            throw new Error(`Invalid config file ${path}: "logging.file" must be a string.`);
          })();
  const maxMbRaw = value.maxMb;
  const maxMb =
    typeof maxMbRaw === "number" && Number.isFinite(maxMbRaw) && maxMbRaw > 0
      ? maxMbRaw
      : typeof maxMbRaw === "undefined"
        ? undefined
        : (() => {
            throw new Error(`Invalid config file ${path}: "logging.maxMb" must be a number.`);
          })();
  const maxFilesRaw = value.maxFiles;
  const maxFiles =
    typeof maxFilesRaw === "number" && Number.isFinite(maxFilesRaw) && maxFilesRaw > 0
      ? Math.trunc(maxFilesRaw)
      : typeof maxFilesRaw === "undefined"
        ? undefined
        : (() => {
            throw new Error(`Invalid config file ${path}: "logging.maxFiles" must be a number.`);
          })();
  return enabled ||
    level ||
    format ||
    file ||
    typeof maxMb === "number" ||
    typeof maxFiles === "number"
    ? {
        ...(typeof enabled === "boolean" ? { enabled } : {}),
        ...(level ? { level } : {}),
        ...(format ? { format } : {}),
        ...(file ? { file } : {}),
        ...(typeof maxMb === "number" ? { maxMb } : {}),
        ...(typeof maxFiles === "number" ? { maxFiles } : {}),
      }
    : undefined;
}

export function parseOpenAiConfig(
  root: Record<string, unknown>,
  path: string,
): OpenAiConfig | undefined {
  const value = root.openai;
  if (typeof value === "undefined") return undefined;
  if (!isRecord(value)) {
    throw new Error(`Invalid config file ${path}: "openai" must be an object.`);
  }
  const baseUrl = parseOptionalBaseUrl(value.baseUrl);
  const useChatCompletions =
    typeof value.useChatCompletions === "boolean" ? value.useChatCompletions : undefined;
  const whisperUsdPerMinuteRaw = value.whisperUsdPerMinute;
  const whisperUsdPerMinute =
    typeof whisperUsdPerMinuteRaw === "number" &&
    Number.isFinite(whisperUsdPerMinuteRaw) &&
    whisperUsdPerMinuteRaw > 0
      ? whisperUsdPerMinuteRaw
      : undefined;

  return typeof baseUrl === "string" ||
    typeof useChatCompletions === "boolean" ||
    typeof whisperUsdPerMinute === "number"
    ? {
        ...(typeof baseUrl === "string" ? { baseUrl } : {}),
        ...(typeof useChatCompletions === "boolean" ? { useChatCompletions } : {}),
        ...(typeof whisperUsdPerMinute === "number" ? { whisperUsdPerMinute } : {}),
      }
    : undefined;
}

export function parseEnvConfig(root: Record<string, unknown>, path: string): EnvConfig | undefined {
  const value = root.env;
  if (typeof value === "undefined") return undefined;
  if (!isRecord(value)) {
    throw new Error(`Invalid config file ${path}: "env" must be an object.`);
  }
  const env: EnvConfig = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim();
    if (key.length === 0) {
      throw new Error(`Invalid config file ${path}: "env" contains an empty key.`);
    }
    if (typeof rawValue !== "string") {
      throw new Error(`Invalid config file ${path}: "env.${rawKey}" must be a string.`);
    }
    env[key] = rawValue;
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

export function parseApiKeysConfig(
  root: Record<string, unknown>,
  path: string,
): ApiKeysConfig | undefined {
  const value = root.apiKeys;
  if (typeof value === "undefined") return undefined;
  if (!isRecord(value)) {
    throw new Error(`Invalid config file ${path}: "apiKeys" must be an object.`);
  }
  const keys: Record<string, string> = {};
  const allowed = [
    "openai",
    "nvidia",
    "anthropic",
    "google",
    "xai",
    "openrouter",
    "zai",
    "apify",
    "firecrawl",
    "fal",
    "groq",
    "assemblyai",
  ];
  for (const [key, val] of Object.entries(value)) {
    const normalizedKey = key.trim().toLowerCase();
    if (!allowed.includes(normalizedKey)) {
      throw new Error(`Invalid config file ${path}: unknown apiKeys provider "${key}".`);
    }
    if (typeof val !== "string" || val.trim().length === 0) {
      throw new Error(`Invalid config file ${path}: "apiKeys.${key}" must be a non-empty string.`);
    }
    keys[normalizedKey] = val.trim();
  }
  return Object.keys(keys).length > 0 ? (keys as ApiKeysConfig) : undefined;
}
