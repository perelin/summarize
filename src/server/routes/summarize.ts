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
  timeoutMs: null,
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
    // ---- Multipart / file upload: not yet implemented ----
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
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

    const modelOverride = body.model ?? null;

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

          const response: SummarizeResponse = {
            summary: extracted.content,
            metadata: {
              title: extracted.title ?? null,
              source: body.url,
              model: "none",
              usage: null,
              durationMs: 0,
            },
          };
          return c.json(response);
        }

        // Summarize URL
        const chunks: string[] = [];
        const sink: StreamSink = {
          writeChunk: (text) => chunks.push(text),
          onModelChosen: () => {},
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

        const response: SummarizeResponse = {
          summary: chunks.join(""),
          metadata: {
            title: null,
            source: body.url,
            model: result.usedModel,
            usage: result.report?.llm?.[0]
              ? {
                  inputTokens: result.report.llm[0].promptTokens ?? 0,
                  outputTokens: result.report.llm[0].completionTokens ?? 0,
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
        onModelChosen: () => {},
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

      const response: SummarizeResponse = {
        summary: chunks.join(""),
        metadata: {
          title: null,
          source: "text",
          model: result.usedModel,
          usage: result.report?.llm?.[0]
            ? {
                inputTokens: result.report.llm[0].promptTokens ?? 0,
                outputTokens: result.report.llm[0].completionTokens ?? 0,
              }
            : null,
          durationMs: result.metrics.elapsedMs,
        },
      };

      return c.json(response);
    } catch (err) {
      console.error("[summarize-api]", err);
      const message = err instanceof Error ? err.message : "";
      const isTimeout =
        message.toLowerCase().includes("timeout") || message.toLowerCase().includes("timed out");

      if (isTimeout) {
        return c.json(jsonError("TIMEOUT", "Request timed out"), 504);
      }

      return c.json(jsonError("SERVER_ERROR", "Internal server error"), 500);
    }
  });

  return route;
}
