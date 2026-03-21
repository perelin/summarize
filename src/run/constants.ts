export { getBuiltinModels } from "../config/default-models.js";

export const TWITTER_TOOL_TIP =
  "Tip: Install xurl (preferred) or bird for better X support: brew install --cask xdevplatform/tap/xurl";
export const BIRD_TIP = TWITTER_TOOL_TIP;
export const UVX_TIP =
  "Tip: Install uv (uvx) for local Markdown conversion: brew install uv (or set UVX_PATH to your uvx binary).";
export const TWITTER_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com"]);
export const MAX_TEXT_BYTES_DEFAULT = 10 * 1024 * 1024;

export const VERBOSE_PREFIX = "[summarize]";
