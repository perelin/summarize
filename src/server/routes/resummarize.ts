import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { CacheState } from "../../cache.js";
import type { SummarizeConfig } from "../../config.js";
import type { MediaCache } from "../../content/index.js";
import type { HistoryStore } from "../../history.js";
import type { RunOverrides } from "../../run/run-settings.js";
import { streamSummaryForText, type StreamSink } from "../../summarize/pipeline.js";
import type { ApiLength } from "../types.js";
import { mapApiLength } from "../utils/length-map.js";

export type ResummarizeRouteDeps = {
  env: Record<string, string | undefined>;
  config: SummarizeConfig | null;
  cache: CacheState;
  mediaCache: MediaCache | null;
  historyStore: HistoryStore;
};

type Variables = { account: string };

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
};

/** Extract the first Markdown heading from a summary to use as a display title. */
function extractFirstHeading(markdown: string): string | null {
  const match = markdown.match(/^#{1,6}\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

function classifyError(err: unknown): { code: string; message: string } {
  const message = err instanceof Error ? err.message : "Internal error";
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return { code: "TIMEOUT", message: "Request timed out" };
  }
  return { code: "SUMMARIZE_FAILED", message };
}

export function createResummarizeRoute(deps: ResummarizeRouteDeps): Hono<{ Variables: Variables }> {
  const route = new Hono<{ Variables: Variables }>();

  route.post("/history/:id/resummarize", async (c) => {
    const account = c.get("account") as string;
    const entryId = c.req.param("id");

    // Load existing entry
    const entry = deps.historyStore.getById(entryId, account);
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "History entry not found" } }, 404);
    }

    if (!entry.transcript || entry.transcript.length === 0) {
      return c.json(
        {
          error: {
            code: "NO_TRANSCRIPT",
            message: "No source text available for re-summarization",
          },
        },
        422,
      );
    }

    // Parse and validate length
    const body = await c.req
      .json<{ length?: ApiLength; model?: string }>()
      .catch((): { length?: ApiLength; model?: string } => ({}));
    if (!body.length) {
      return c.json(
        { error: { code: "MISSING_LENGTH", message: "length parameter is required" } },
        400,
      );
    }

    let lengthRaw: string;
    try {
      lengthRaw = mapApiLength(body.length);
    } catch {
      return c.json(
        { error: { code: "INVALID_LENGTH", message: `Invalid length: ${body.length}` } },
        400,
      );
    }

    const modelOverride = body.model ?? null;
    const summaryId = randomUUID();
    const startTime = Date.now();

    console.log(`[summarize-api] resummarize: id=${entryId} length=${body.length} (${lengthRaw})`);

    const wantsSSE = c.req.header("accept")?.includes("text/event-stream");

    if (wantsSSE) {
      return streamSSE(c, async (stream) => {
        const chunks: string[] = [];

        const sink: StreamSink = {
          writeChunk: (text: string) => {
            chunks.push(text);
            void stream.writeSSE({ event: "chunk", data: JSON.stringify({ text }) });
          },
          onModelChosen: (model: string) => {
            console.log(`[summarize-api] resummarize model chosen: ${model}`);
          },
          writeStatus: (text: string) => {
            void stream.writeSSE({ event: "status", data: JSON.stringify({ text }) });
          },
        };

        // Emit init
        await stream.writeSSE({
          event: "init",
          data: JSON.stringify({ summaryId }),
        });

        try {
          const result = await streamSummaryForText({
            env: deps.env,
            fetchImpl: fetch,
            input: {
              url: entry.sourceUrl ?? "text://resummarize",
              title: entry.title,
              text: entry.transcript!,
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

          // Emit metrics
          const metricsEvt: Record<string, unknown> = {
            elapsedMs: result.metrics.elapsedMs,
            summary: result.metrics.summary,
            details: result.metrics.details,
            summaryDetailed: result.metrics.summaryDetailed,
            detailsDetailed: result.metrics.detailsDetailed,
            pipeline: result.metrics.pipeline,
          };
          await stream.writeSSE({
            event: "metrics",
            data: JSON.stringify(metricsEvt),
          });

          // Update history entry
          const summaryText = chunks.join("");
          try {
            deps.historyStore.updateSummary(entryId, account, {
              summary: summaryText,
              inputLength: lengthRaw,
              model: result.usedModel,
              title: extractFirstHeading(summaryText) ?? entry.title,
              metadata: result.insights ? JSON.stringify(result.insights) : entry.metadata,
            });
          } catch (histErr) {
            console.error("[summarize-api] resummarize history update failed:", histErr);
          }

          // Done
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({ summaryId: entryId }),
          });

          const elapsed = Date.now() - startTime;
          console.log(
            `[summarize-api] resummarize complete: id=${entryId} length=${body.length} ${elapsed}ms`,
          );
        } catch (err) {
          console.error("[summarize-api] resummarize error:", err);
          const classified = classifyError(err);
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ message: classified.message, code: classified.code }),
          });
        }
      });
    }

    // Non-SSE JSON fallback
    return c.json(
      {
        error: {
          code: "SSE_REQUIRED",
          message: "This endpoint requires Accept: text/event-stream",
        },
      },
      406,
    );
  });

  return route;
}
