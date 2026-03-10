import { Hono } from "hono";
import type { CacheState } from "../../cache.js";
import type { SummarizeConfig } from "../../config.js";
import type { MediaCache } from "../../content/index.js";
import type { RunOverrides } from "../../run/run-settings.js";
import {
  extractContentForUrl,
  streamSummaryForUrl,
  streamSummaryForVisiblePage,
  type StreamSink,
} from "../../daemon/summarize.js";
import type { ApiError, SummarizeJsonBody, SummarizeResponse } from "../types.js";
import { mapApiLength } from "../utils/length-map.js";

export type SummarizeRouteDeps = {
  env: Record<string, string | undefined>;
  config: SummarizeConfig | null;
  cache: CacheState;
  mediaCache: MediaCache | null;
};

const DEFAULT_OVERRIDES: RunOverrides = {
  firecrawlMode: null,
  markdownMode: null,
  preprocessMode: null,
  youtubeMode: null,
  videoMode: null,
  transcriptTimestamps: null,
  forceSummary: null,
  timeoutMs: 300_000,
  retries: null,
  maxOutputTokensArg: null,
  transcriber: null,
  autoCliFallbackEnabled: null,
  autoCliOrder: null,
};

function jsonError(code: string, message: string): ApiError {
  return { error: { code, message } };
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function createSummarizeRoute(deps: SummarizeRouteDeps): Hono {
  const route = new Hono();

  route.post("/summarize", async (c) => {
    const startTime = Date.now();

    // ---- Multipart / file upload: not yet implemented ----
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      console.log("[summarize-api] rejected multipart/form-data request (not implemented)");
      return c.json(jsonError("NOT_IMPLEMENTED", "File upload is not yet supported"), 501);
    }

    // ---- Parse body ----
    let body: SummarizeJsonBody;
    try {
      body = (await c.req.json()) as SummarizeJsonBody;
    } catch {
      return c.json(jsonError("INVALID_INPUT", "Invalid JSON body"), 400);
    }

    // ---- Runtime type validation ----
    if (body.url !== undefined && typeof body.url !== "string") {
      return c.json(jsonError("INVALID_INPUT", "url must be a string"), 400);
    }
    if (body.text !== undefined && typeof body.text !== "string") {
      return c.json(jsonError("INVALID_INPUT", "text must be a string"), 400);
    }

    // ---- Input validation ----
    if (!body.url && !body.text) {
      return c.json(jsonError("INVALID_INPUT", "Must provide url or text"), 400);
    }

    if (body.url && !isHttpUrl(body.url)) {
      return c.json(jsonError("INVALID_INPUT", "URL must use http or https protocol"), 400);
    }

    let lengthRaw: string;
    try {
      lengthRaw = mapApiLength(body.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid length";
      return c.json(jsonError("INVALID_INPUT", msg), 400);
    }

    const modelOverride = body.model ?? deps.env.SUMMARIZE_DEFAULT_MODEL ?? null;

    const mode = body.url ? (body.extract ? "extract" : "url") : "text";
    const source = body.url ?? `text(${body.text!.length} chars)`;
    console.log(
      `[summarize-api] summarize request: mode=${mode} source=${source} length=${lengthRaw}${modelOverride ? ` model=${modelOverride}` : ""}`,
    );

    try {
      // ---- URL mode ----
      if (body.url) {
        // Extract-only mode
        if (body.extract) {
          const { extracted } = await extractContentForUrl({
            env: deps.env,
            fetchImpl: fetch,
            input: { url: body.url, title: null, maxCharacters: null },
            cache: deps.cache,
            mediaCache: deps.mediaCache,
            overrides: DEFAULT_OVERRIDES,
          });

          const elapsed = Date.now() - startTime;
          console.log(
            `[summarize-api] extract complete: title=${JSON.stringify(extracted.title ?? "")} ${elapsed}ms`,
          );

          const response: SummarizeResponse = {
            summary: extracted.content,
            metadata: {
              title: extracted.title ?? null,
              source: body.url,
              model: "none",
              usage: null,
              durationMs: elapsed,
            },
          };
          return c.json(response);
        }

        // Summarize URL
        const chunks: string[] = [];
        const sink: StreamSink = {
          writeChunk: (text) => chunks.push(text),
          onModelChosen: (model) =>
            console.log(`[summarize-api] model chosen: ${model}`),
        };

        const result = await streamSummaryForUrl({
          env: deps.env,
          fetchImpl: fetch,
          input: { url: body.url, title: null, maxCharacters: null },
          modelOverride,
          promptOverride: null,
          lengthRaw,
          languageRaw: null,
          sink,
          cache: deps.cache,
          mediaCache: deps.mediaCache,
          overrides: DEFAULT_OVERRIDES,
        });

        const elapsed = Date.now() - startTime;
        const usage = result.report?.llm?.[0];
        console.log(
          `[summarize-api] summarize complete: model=${result.usedModel} tokens=${usage ? `${usage.promptTokens ?? 0}+${usage.completionTokens ?? 0}` : "n/a"} ${elapsed}ms`,
        );

        const response: SummarizeResponse = {
          summary: chunks.join(""),
          metadata: {
            title: null,
            source: body.url,
            model: result.usedModel,
            usage: usage
              ? {
                  inputTokens: usage.promptTokens ?? 0,
                  outputTokens: usage.completionTokens ?? 0,
                }
              : null,
            durationMs: result.metrics.elapsedMs,
          },
        };

        return c.json(response);
      }

      // ---- Text mode ----
      const chunks: string[] = [];
      const sink: StreamSink = {
        writeChunk: (text) => chunks.push(text),
        onModelChosen: (model) =>
          console.log(`[summarize-api] model chosen: ${model}`),
      };

      const result = await streamSummaryForVisiblePage({
        env: deps.env,
        fetchImpl: fetch,
        input: {
          url: "text://input",
          title: null,
          text: body.text!,
          truncated: false,
        },
        modelOverride,
        promptOverride: null,
        lengthRaw,
        languageRaw: null,
        sink,
        cache: deps.cache,
        mediaCache: deps.mediaCache,
        overrides: DEFAULT_OVERRIDES,
      });

      const elapsed = Date.now() - startTime;
      const usage = result.report?.llm?.[0];
      console.log(
        `[summarize-api] summarize complete: model=${result.usedModel} tokens=${usage ? `${usage.promptTokens ?? 0}+${usage.completionTokens ?? 0}` : "n/a"} ${elapsed}ms`,
      );

      const response: SummarizeResponse = {
        summary: chunks.join(""),
        metadata: {
          title: null,
          source: "text",
          model: result.usedModel,
          usage: usage
            ? {
                inputTokens: usage.promptTokens ?? 0,
                outputTokens: usage.completionTokens ?? 0,
              }
            : null,
          durationMs: result.metrics.elapsedMs,
        },
      };

      return c.json(response);
    } catch (err) {
      console.error("[summarize-api]", err);
      const message = err instanceof Error ? err.message : "";
      const lower = message.toLowerCase();

      // Timeout
      if (lower.includes("timeout") || lower.includes("timed out")) {
        return c.json(jsonError("TIMEOUT", "Request timed out"), 504);
      }

      // HTTP fetch failures (e.g. "Failed to fetch HTML document (status 403)")
      const httpMatch = message.match(/Failed to fetch HTML document \(status (\d+)\)/);
      if (httpMatch) {
        const status = parseInt(httpMatch[1]);
        const hint =
          status === 403
            ? " — the site may be blocking automated access"
            : status === 404
              ? " — page not found"
              : status === 429
                ? " — rate limited, try again later"
                : status >= 500
                  ? " — the site appears to be having issues"
                  : "";
        return c.json(
          jsonError("FETCH_FAILED", `Could not fetch content from URL (HTTP ${status}${hint})`),
          502,
        );
      }

      // Unsupported content type
      if (lower.includes("unsupported content-type")) {
        return c.json(
          jsonError("UNSUPPORTED_CONTENT", "The URL does not point to a supported content type"),
          422,
        );
      }

      // Transcription failures
      if (lower.includes("failed to transcribe")) {
        return c.json(
          jsonError("TRANSCRIPTION_FAILED", "Failed to transcribe audio/video content"),
          502,
        );
      }

      // Blocked content (captcha, etc.)
      if (lower.includes("captcha") || lower.includes("blocked")) {
        return c.json(
          jsonError("CONTENT_BLOCKED", "The site blocked access to this content"),
          502,
        );
      }

      // X/Twitter content
      if (lower.includes("unable to fetch tweet")) {
        return c.json(jsonError("FETCH_FAILED", "Could not fetch content from X/Twitter"), 502);
      }

      return c.json(jsonError("SERVER_ERROR", "Internal server error"), 500);
    }
  });

  return route;
}
