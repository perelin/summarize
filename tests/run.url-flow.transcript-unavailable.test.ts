import { mkdtempSync } from "node:fs";
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

describe("runUrlFlow transcript-unavailable handling", () => {
  it("surfaces the error instead of summarizing an empty extraction", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-url-flow-transcript-"));
    const url = "https://www.youtube.com/watch?v=-RXD4bTuFTo";

    const fetchImpl: typeof fetch = async (input) => {
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

    const cache: CacheState = {
      mode: "bypass",
      store: null,
      ttlMs: 0,
      maxBytes: 0,
      path: null,
    };

    const ctx = createServerUrlFlowContext({
      env: { HOME: root, OPENAI_API_KEY: "test" },
      fetchImpl,
      cache,
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
});
