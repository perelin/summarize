import { describe, expect, it } from "vitest";
import { createLinkPreviewClient } from "../src/content/index.js";
import { readTweetWithPreferredClient } from "../src/run/bird.js";
import { resolveTwitterCookies } from "../src/run/cookies/twitter.js";
import { resolveExecutableInPath } from "../src/run/env.js";

const ENV = process.env as Record<string, string | undefined>;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? null;
const FAL_KEY = process.env.FAL_KEY ?? null;
const YT_DLP_PATH = process.env.YT_DLP_PATH ?? null;
const BIRD_PATH = resolveExecutableInPath("bird", ENV);
const TWEET_URL = process.env.SUMMARIZE_LIVE_TWITTER_BROADCAST_URL ?? null;

const LIVE =
  process.env.SUMMARIZE_LIVE_TESTS === "1" &&
  Boolean(TWEET_URL) &&
  Boolean(YT_DLP_PATH) &&
  Boolean(BIRD_PATH) &&
  (Boolean(OPENAI_API_KEY) || Boolean(FAL_KEY));
const LIVE_FETCH_TIMEOUT_MS = Number(
  process.env.SUMMARIZE_LIVE_TWITTER_FETCH_TIMEOUT_MS ?? "300000",
);
const LIVE_FETCH_TEST_TIMEOUT_MS = Number(
  process.env.SUMMARIZE_LIVE_TWITTER_TEST_TIMEOUT_MS ?? "480000",
);

const createClient = () =>
  createLinkPreviewClient({
    groqApiKey: null,
    openaiApiKey: OPENAI_API_KEY,
    falApiKey: FAL_KEY,
    ytDlpPath: YT_DLP_PATH,
    readTweetWithBird: ({ url, timeoutMs }) =>
      readTweetWithPreferredClient({ url, timeoutMs, env: ENV }),
    resolveTwitterCookies: async () => {
      const res = await resolveTwitterCookies({ env: ENV });
      return {
        cookiesFromBrowser: res.cookies.cookiesFromBrowser,
        source: res.cookies.source,
        warnings: res.warnings,
      };
    },
  });

describe("live X broadcast (tweet video)", () => {
  const run = LIVE ? it : it.skip;

  run(
    "transcribes tweet video via yt-dlp and exposes a video url",
    async () => {
      const client = createClient();
      const result = await client.fetchLinkContent(TWEET_URL!, {
        timeoutMs: LIVE_FETCH_TIMEOUT_MS,
      });

      expect(result.video).not.toBeNull();
      expect(result.transcriptSource).not.toBeNull();
      expect(result.transcriptCharacters ?? 0).toBeGreaterThan(20);
    },
    LIVE_FETCH_TEST_TIMEOUT_MS,
  );
});
