import type { SummarizeConfig } from "../config.js";
import { resolveExecutableInPath } from "./env.js";

export type EnvState = {
  /** LiteLLM gateway base URL. */
  litellmBaseUrl: string;
  /** LiteLLM API key (optional, depends on gateway config). */
  litellmApiKey: string | null;
  /** Model ID for summarization (from env override or config). */
  model: string;
  /** Model ID for STT (from config). */
  sttModel: string;
  /** Firecrawl API key for content extraction. */
  firecrawlApiKey: string | null;
  firecrawlConfigured: boolean;
  /** Apify token for content extraction. */
  apifyToken: string | null;
  /** yt-dlp binary path. */
  ytDlpPath: string | null;
  ytDlpCookiesFromBrowser: string | null;
};

const DEFAULT_LITELLM_BASE_URL = "http://10.10.10.10:4000";
const DEFAULT_MODEL = "mistral/mistral-large-latest";
const DEFAULT_STT_MODEL = "mistral/voxtral-mini-latest";

export function resolveEnvState({
  env,
  envForRun,
  config,
}: {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  config: SummarizeConfig | null;
}): EnvState {
  const litellmBaseUrl =
    envForRun.LITELLM_BASE_URL?.trim() ||
    config?.litellm?.baseUrl?.trim() ||
    DEFAULT_LITELLM_BASE_URL;

  const litellmApiKey =
    envForRun.LITELLM_API_KEY?.trim() ||
    config?.litellm?.apiKey?.trim() ||
    null;

  const model =
    envForRun.SUMMARIZE_MODEL?.trim() ||
    config?.model?.trim() ||
    DEFAULT_MODEL;

  const sttModel =
    config?.sttModel?.trim() ||
    DEFAULT_STT_MODEL;

  const firecrawlApiKey =
    typeof envForRun.FIRECRAWL_API_KEY === "string" && envForRun.FIRECRAWL_API_KEY.trim().length > 0
      ? envForRun.FIRECRAWL_API_KEY
      : null;

  const apifyToken =
    typeof envForRun.APIFY_API_TOKEN === "string" ? envForRun.APIFY_API_TOKEN : null;

  const ytDlpPath = (() => {
    const explicit = typeof envForRun.YT_DLP_PATH === "string" ? envForRun.YT_DLP_PATH.trim() : "";
    if (explicit.length > 0) return explicit;
    return resolveExecutableInPath("yt-dlp", envForRun);
  })();

  const ytDlpCookiesFromBrowser = (() => {
    const raw =
      typeof envForRun.SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER === "string"
        ? envForRun.SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER
        : typeof envForRun.YT_DLP_COOKIES_FROM_BROWSER === "string"
          ? envForRun.YT_DLP_COOKIES_FROM_BROWSER
          : "";
    const value = raw.trim();
    return value.length > 0 ? value : null;
  })();

  return {
    litellmBaseUrl,
    litellmApiKey,
    model,
    sttModel,
    firecrawlApiKey,
    firecrawlConfigured: firecrawlApiKey !== null,
    apifyToken,
    ytDlpPath,
    ytDlpCookiesFromBrowser,
  };
}
