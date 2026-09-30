import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CacheState } from "../src/cache.js";
import { runUrlFlow } from "../src/run/flows/url/flow.js";
import { createServerUrlFlowContext } from "../src/summarize/flow-context.js";

// A watch page that bootstraps but carries no caption tracks. With no yt-dlp binary in
// the environment there is no transcript rung left, so extraction throws
// TranscriptUnavailableError — which the url-only fallback used to swallow, handing the
// LLM an empty prompt and passing its apology off as a summary.
const WATCH_PAGE = `<!doctype html><html><head><title>No captions</title></head>
<body><script>var ytInitialPlayerResponse = {"videoDetails":{"shortDescription":"a blurb"}};</script></body></html>`;

// Stands in for a yt-dlp that is bot-blocked on a direct connection and rejected by the
// fallback proxy — the exact shape of the 2026-09-29 outage.
const FAKE_YT_DLP = `#!/bin/sh
proxy=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "--proxy" ]; then proxy="$arg"; fi
  previous="$arg"
done
if [ -n "$proxy" ]; then
  echo "ERROR: Unable to download API page: <urlopen error Tunnel connection failed: 407 Proxy Authentication Required>" >&2
else
  echo "ERROR: [youtube] Sign in to confirm you're not a bot." >&2
fi
exit 1
`;

function cacheState(): CacheState {
  return {
    mode: "bypass",
    store: null,
    ttlMs: 0,
    maxBytes: 0,
    path: null,
  };
}

function watchPageFetch(url: string): typeof fetch {
  return async (input) => {
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (requestUrl.startsWith(url)) {
      return new Response(WATCH_PAGE, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("", { status: 404 });
  };
}

describe("runUrlFlow transcript-unavailable handling", () => {
  it("surfaces the error instead of summarizing an empty extraction", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-url-flow-transcript-"));
    const url = "https://www.youtube.com/watch?v=-RXD4bTuFTo";

    const ctx = createServerUrlFlowContext({
      env: { HOME: root, OPENAI_API_KEY: "test" },
      fetchImpl: watchPageFetch(url),
      cache: cacheState(),
      modelOverride: "openai/gpt-5.2",
      promptOverride: null,
      lengthRaw: "short",
      languageRaw: "auto",
      maxExtractCharacters: null,
      hooks: {},
      runStartedAtMs: Date.now(),
      stdoutSink: { writeChunk: () => {} },
    });

    ctx.flags.extractMode = true;

    await expect(runUrlFlow({ ctx, url, isYoutubeUrl: true })).rejects.toThrow(
      /No transcript available/i,
    );
  }, 20_000);

  it("surfaces a rejected media proxy instead of summarizing an empty extraction", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-url-flow-proxy-"));
    const ytDlpPath = join(root, "yt-dlp");
    writeFileSync(ytDlpPath, FAKE_YT_DLP, { mode: 0o755 });
    const url = "https://www.youtube.com/watch?v=-RXD4bTuFTo";

    // The proxy URL is read from the process environment (it is a deployment concern, not a
    // per-request provider setting), so the test has to set it there.
    const previousProxy = process.env.YT_DLP_PROXY;
    process.env.YT_DLP_PROXY = "http://proxy.invalid:7777";
    try {
      const ctx = createServerUrlFlowContext({
        env: { HOME: root, OPENAI_API_KEY: "test", YT_DLP_PATH: ytDlpPath },
        fetchImpl: watchPageFetch(url),
        cache: cacheState(),
        modelOverride: "openai/gpt-5.2",
        promptOverride: null,
        lengthRaw: "short",
        languageRaw: "auto",
        maxExtractCharacters: null,
        hooks: {},
        runStartedAtMs: Date.now(),
        stdoutSink: { writeChunk: () => {} },
      });

      ctx.flags.extractMode = true;

      await expect(runUrlFlow({ ctx, url, isYoutubeUrl: true })).rejects.toThrow(
        /407 Proxy Authentication Required/,
      );
    } finally {
      if (previousProxy === undefined) delete process.env.YT_DLP_PROXY;
      else process.env.YT_DLP_PROXY = previousProxy;
    }
  }, 30_000);
});
