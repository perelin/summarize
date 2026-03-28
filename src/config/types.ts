export type VideoMode = "auto" | "transcript" | "understand";

export type MediaCacheVerifyMode = "none" | "size" | "hash";
export type MediaCacheConfig = {
  enabled?: boolean;
  maxMb?: number;
  ttlDays?: number;
  path?: string;
  verify?: MediaCacheVerifyMode;
};

export type ApiKeysConfig = {
  apify?: string;
  firecrawl?: string;
};

export type EnvConfig = Record<string, string>;

export type LoggingLevel = "debug" | "info" | "warn" | "error";
export type LoggingFormat = "json" | "pretty";
export type LoggingConfig = {
  enabled?: boolean;
  level?: LoggingLevel;
  format?: LoggingFormat;
  file?: string;
  maxMb?: number;
  maxFiles?: number;
};

export type LiteLlmConfig = {
  /** LiteLLM gateway base URL (e.g. "http://10.10.10.10:4000"). */
  baseUrl?: string;
  /** API key for LiteLLM gateway (optional, depends on gateway config). */
  apiKey?: string;
};

export type Account = {
  name: string;
  token: string;
};

export type SummarizeConfig = {
  accounts?: Account[];
  /** LiteLLM gateway configuration. */
  litellm?: LiteLlmConfig;
  /** Model ID to use (e.g. "gpt-4o", "claude-opus-4"). */
  model?: string;
  /** Speech-to-text model ID for transcription. */
  sttModel?: string;
  /**
   * Output language for summaries (default: auto = match source content language).
   *
   * Examples: "en", "de", "english", "german", "pt-BR".
   */
  language?: string;
  /**
   * Summary prompt override (replaces the built-in instruction block).
   */
  prompt?: string;
  /**
   * Cache settings for extracted content, transcripts, and summaries.
   */
  cache?: {
    enabled?: boolean;
    maxMb?: number;
    ttlDays?: number;
    path?: string;
    media?: MediaCacheConfig;
  };
  /**
   * History settings for persisting summarization results.
   */
  history?: {
    enabled?: boolean;
    path?: string;
    mediaPath?: string;
  };
  media?: {
    videoMode?: VideoMode;
  };
  output?: {
    /**
     * Output language for the summary (e.g. "auto", "en", "de", "English").
     *
     * - "auto": match the source language (default behavior when unset)
     * - otherwise: translate the output into the requested language
     */
    language?: string;
  };
  logging?: LoggingConfig;
  /**
   * Generic environment variable defaults.
   *
   * Precedence: process env > config file env.
   */
  env?: EnvConfig;
  /**
   * Legacy API key shortcuts. Prefer `env` for new configs.
   *
   * Precedence: environment variables > config file apiKeys.
   */
  apiKeys?: ApiKeysConfig;
};
