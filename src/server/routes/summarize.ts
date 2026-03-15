import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import type { SseEvent } from "@steipete/summarize_p2-core/sse";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { CacheState } from "../../cache.js";
import type { SummarizeConfig } from "../../config.js";
import type { MediaCache } from "../../content/index.js";
import type { HistoryStore } from "../../history.js";
import type { RunOverrides } from "../../run/run-settings.js";
import {
  extractContentForUrl,
  streamSummaryForUrl,
  streamSummaryForVisiblePage,
  type StreamSink,
} from "../../summarize/pipeline.js";
import { describeImage } from "../handlers/upload-image.js";
import { transcribeUploadedMedia } from "../handlers/upload-media.js";
import { extractPdfText } from "../handlers/upload-pdf.js";
import type { SseSessionManager } from "../sse-session.js";
import type {
  ApiError,
  SummarizeJsonBody,
  SummarizeResponse,
  SummarizeInsights,
} from "../types.js";
import { detectUploadType, MAX_UPLOAD_BYTES } from "../utils/file-types.js";
import { mapApiLength } from "../utils/length-map.js";

export type SummarizeRouteDeps = {
  env: Record<string, string | undefined>;
  config: SummarizeConfig | null;
  cache: CacheState;
  mediaCache: MediaCache | null;
  historyStore?: HistoryStore | null;
  historyMediaPath?: string | null;
  sseSessionManager?: SseSessionManager | null;
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

function detectSourceType(insights: SummarizeInsights | null, hasUrl: boolean): string {
  if (!hasUrl) return "text";
  if (!insights) return "article";
  const ts = insights.transcriptSource;
  if (ts && (ts.includes("youtube") || ts === "captionTracks" || ts === "yt-dlp")) return "video";
  if (insights.mediaDurationSeconds != null && insights.transcriptionProvider) return "podcast";
  return "article";
}

type Variables = { account: string };

/**
 * Classify an error into an SSE-friendly code + message pair.
 * Reused by both the JSON and SSE error paths.
 */
function classifyError(err: unknown): {
  code: string;
  message: string;
  httpStatus: number;
} {
  const message = err instanceof Error ? err.message : "";
  const lower = message.toLowerCase();

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return { code: "TIMEOUT", message: "Request timed out", httpStatus: 504 };
  }

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
    return {
      code: "FETCH_FAILED",
      message: `Could not fetch content from URL (HTTP ${status}${hint})`,
      httpStatus: 502,
    };
  }

  if (lower.includes("unsupported content-type")) {
    return {
      code: "UNSUPPORTED_CONTENT",
      message: "The URL does not point to a supported content type",
      httpStatus: 422,
    };
  }

  if (lower.includes("failed to transcribe")) {
    return {
      code: "TRANSCRIPTION_FAILED",
      message: "Failed to transcribe audio/video content",
      httpStatus: 502,
    };
  }

  if (lower.includes("captcha") || lower.includes("blocked")) {
    return {
      code: "CONTENT_BLOCKED",
      message: "The site blocked access to this content",
      httpStatus: 502,
    };
  }

  if (lower.includes("unable to fetch tweet")) {
    return {
      code: "FETCH_FAILED",
      message: "Could not fetch content from X/Twitter",
      httpStatus: 502,
    };
  }

  return {
    code: "SERVER_ERROR",
    message: "Internal server error",
    httpStatus: 500,
  };
}

/**
 * Build a StreamSink that emits SSE events and buffers chunks for the final response.
 * Used by both the file-upload and URL/text SSE paths.
 */
function buildSseSink(
  stream: { writeSSE: (msg: { event: string; data: string; id: string }) => Promise<void> },
  pushAndBuffer: (evt: SseEvent) => number,
  chunks: string[],
): { sink: StreamSink; getChosenModel: () => string | null } {
  let chosenModel: string | null = null;
  const sink: StreamSink = {
    writeChunk: (text) => {
      chunks.push(text);
      const evt: SseEvent = { event: "chunk", data: { text } };
      const id = pushAndBuffer(evt);
      void stream.writeSSE({ event: "chunk", data: JSON.stringify(evt.data), id: String(id) });
    },
    onModelChosen: (model) => {
      chosenModel = model;
      console.log(`[summarize-api] model chosen: ${model}`);
      const evt: SseEvent = {
        event: "meta",
        data: { model, modelLabel: model, inputSummary: null },
      };
      const id = pushAndBuffer(evt);
      void stream.writeSSE({ event: "meta", data: JSON.stringify(evt.data), id: String(id) });
    },
    writeStatus: (text) => {
      const evt: SseEvent = { event: "status", data: { text } };
      const id = pushAndBuffer(evt);
      void stream.writeSSE({ event: "status", data: JSON.stringify(evt.data), id: String(id) });
    },
    writeMeta: (data) => {
      const evt: SseEvent = {
        event: "meta",
        data: {
          model: chosenModel,
          modelLabel: chosenModel,
          inputSummary: data.inputSummary ?? null,
          summaryFromCache: data.summaryFromCache ?? null,
        },
      };
      const id = pushAndBuffer(evt);
      void stream.writeSSE({ event: "meta", data: JSON.stringify(evt.data), id: String(id) });
    },
  };
  return { sink, getChosenModel: () => chosenModel };
}

export function createSummarizeRoute(deps: SummarizeRouteDeps): Hono<{ Variables: Variables }> {
  const route = new Hono<{ Variables: Variables }>();

  // ---- Shared input validation (returns parsed body or error response) ----
  function validateBody(body: SummarizeJsonBody): { error: ApiError; status: number } | null {
    if (body.url !== undefined && typeof body.url !== "string") {
      return {
        error: jsonError("INVALID_INPUT", "url must be a string"),
        status: 400,
      };
    }
    if (body.text !== undefined && typeof body.text !== "string") {
      return {
        error: jsonError("INVALID_INPUT", "text must be a string"),
        status: 400,
      };
    }
    if (body.url && body.text) {
      return {
        error: jsonError("INVALID_INPUT", "Provide either url or text, not both"),
        status: 400,
      };
    }
    if (!body.url && !body.text) {
      return {
        error: jsonError("INVALID_INPUT", "Must provide url or text"),
        status: 400,
      };
    }
    if (body.url && !isHttpUrl(body.url)) {
      return {
        error: jsonError("INVALID_INPUT", "URL must use http or https protocol"),
        status: 400,
      };
    }
    return null;
  }

  route.post("/summarize", async (c) => {
    const account = c.get("account") as string;
    const startTime = Date.now();
    const wantsSSE = (c.req.header("accept") ?? "").includes("text/event-stream");

    // ---- Multipart / file upload ----
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const parsed = await c.req.parseBody();
      const file = parsed["file"];
      if (!(file instanceof File)) {
        return c.json(
          jsonError("INVALID_INPUT", "Multipart request must include a 'file' field"),
          400,
        );
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        return c.json(
          jsonError(
            "INVALID_INPUT",
            `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
          ),
          413,
        );
      }

      const uploadType = detectUploadType(file.name, file.type);
      if (!uploadType) {
        return c.json(
          jsonError(
            "UNSUPPORTED_FILE_TYPE",
            `Unsupported file type: ${file.name} (${file.type || "unknown MIME"})`,
          ),
          422,
        );
      }

      // Extract optional form fields
      const lengthField = typeof parsed["length"] === "string" ? parsed["length"] : undefined;
      const modelField = typeof parsed["model"] === "string" ? parsed["model"] : undefined;

      let lengthRaw: string;
      try {
        lengthRaw = mapApiLength(lengthField);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Invalid length";
        return c.json(jsonError("INVALID_INPUT", msg), 400);
      }

      const modelOverride = modelField ?? deps.env.SUMMARIZE_DEFAULT_MODEL ?? null;

      console.log(
        `[summarize-api] [${account}] file upload: type=${uploadType} name=${file.name} size=${(file.size / 1024).toFixed(0)}KB length=${lengthRaw}${modelOverride ? ` model=${modelOverride}` : ""}${wantsSSE ? " (SSE)" : ""}`,
      );

      // ---- Extract text content from the uploaded file ----
      let extractedText: string;
      let sourceLabel: string;
      try {
        if (uploadType === "pdf") {
          extractedText = await extractPdfText(file);
          sourceLabel = `pdf:${file.name}`;
        } else if (uploadType === "image") {
          const description = await describeImage(
            { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
            { env: deps.env, modelOverride, fetchImpl: fetch },
          );
          extractedText = description.text;
          sourceLabel = `image:${file.name}`;
        } else {
          // audio or video
          const result = await transcribeUploadedMedia(
            { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
            { env: deps.env, fetchImpl: fetch },
          );
          extractedText = result.transcript;
          sourceLabel = `${uploadType}:${file.name}`;
        }
      } catch (err) {
        console.error(`[summarize-api] file processing error (${uploadType}):`, err);
        const message = err instanceof Error ? err.message : "File processing failed";
        return c.json(jsonError("FILE_PROCESSING_FAILED", message), 422);
      }

      // ---- SSE streaming path for file upload ----
      if (wantsSSE) {
        const sessionManager = deps.sseSessionManager;
        if (!sessionManager) {
          return c.json(jsonError("SERVER_ERROR", "SSE streaming is not available"), 500);
        }

        const summaryId = randomUUID();
        sessionManager.createSession(summaryId);
        let eventCounter = 0;

        const pushAndBuffer = (event: SseEvent): number => {
          eventCounter++;
          sessionManager.pushEvent(summaryId, event);
          return eventCounter;
        };

        return streamSSE(c, async (stream) => {
          try {
            const initEvt: SseEvent = { event: "init", data: { summaryId } };
            const initId = pushAndBuffer(initEvt);
            await stream.writeSSE({
              event: "init",
              data: JSON.stringify(initEvt.data),
              id: String(initId),
            });

            const chunks: string[] = [];
            const { sink } = buildSseSink(stream, pushAndBuffer, chunks);

            const result = await streamSummaryForVisiblePage({
              env: deps.env,
              fetchImpl: fetch,
              input: {
                url: `upload://${sourceLabel}`,
                title: file.name,
                text: extractedText,
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

            // Emit metrics event
            const metricsEvt: SseEvent = {
              event: "metrics",
              data: {
                elapsedMs: result.metrics.elapsedMs,
                summary: result.metrics.summary,
                details: result.metrics.details,
                summaryDetailed: result.metrics.summaryDetailed,
                detailsDetailed: result.metrics.detailsDetailed,
                pipeline: result.metrics.pipeline,
              },
            };
            const metricsId = pushAndBuffer(metricsEvt);
            await stream.writeSSE({
              event: "metrics",
              data: JSON.stringify(metricsEvt.data),
              id: String(metricsId),
            });

            // Record history (fire-and-forget)
            if (deps.historyStore) {
              void Promise.resolve().then(() => {
                try {
                  deps.historyStore!.insert({
                    id: summaryId,
                    createdAt: new Date().toISOString(),
                    account,
                    sourceUrl: null,
                    sourceType: uploadType,
                    inputLength: lengthRaw,
                    model: result.usedModel,
                    title: file.name,
                    summary: chunks.join(""),
                    transcript: extractedText,
                    mediaPath: null,
                    mediaSize: file.size,
                    mediaType: file.type || null,
                    metadata: result.insights ? JSON.stringify(result.insights) : null,
                  });
                } catch (histErr) {
                  console.error("[summarize-api] history recording failed:", histErr);
                }
              });
            }

            // Final done event
            const doneEvt = {
              event: "done" as const,
              data: { summaryId: String(summaryId) },
            };
            const doneId = pushAndBuffer(doneEvt);
            await stream.writeSSE({
              event: "done",
              data: JSON.stringify(doneEvt.data),
              id: String(doneId),
            });

            sessionManager.markComplete(summaryId);

            const elapsed = Date.now() - startTime;
            console.log(
              `[summarize-api] SSE stream complete (file upload): summaryId=${summaryId} ${elapsed}ms`,
            );
          } catch (err) {
            console.error("[summarize-api] SSE pipeline error (file upload):", err);
            const classified = classifyError(err);
            const errorEvt = {
              event: "error" as const,
              data: { message: classified.message, code: classified.code },
            };
            const errorId = pushAndBuffer(errorEvt);
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify(errorEvt.data),
              id: String(errorId),
            });
          }
        });
      }

      // ---- JSON response path for file upload ----
      try {
        const chunks: string[] = [];
        const sink: StreamSink = {
          writeChunk: (text) => chunks.push(text),
          onModelChosen: (model) => console.log(`[summarize-api] model chosen: ${model}`),
        };

        const result = await streamSummaryForVisiblePage({
          env: deps.env,
          fetchImpl: fetch,
          input: {
            url: `upload://${sourceLabel}`,
            title: file.name,
            text: extractedText,
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
          `[summarize-api] file upload summarize complete: type=${uploadType} model=${result.usedModel} tokens=${usage ? `${usage.promptTokens ?? 0}+${usage.completionTokens ?? 0}` : "n/a"} ${elapsed}ms`,
        );

        const summaryId = randomUUID();
        const response: SummarizeResponse = {
          summaryId,
          summary: chunks.join(""),
          metadata: {
            title: file.name,
            source: sourceLabel,
            model: result.usedModel,
            usage: usage
              ? {
                  inputTokens: usage.promptTokens ?? 0,
                  outputTokens: usage.completionTokens ?? 0,
                }
              : null,
            durationMs: result.metrics.elapsedMs,
          },
          insights: result.insights,
        };

        // Record history (fire-and-forget)
        if (deps.historyStore) {
          void Promise.resolve().then(() => {
            try {
              deps.historyStore!.insert({
                id: summaryId,
                createdAt: new Date().toISOString(),
                account,
                sourceUrl: null,
                sourceType: uploadType,
                inputLength: lengthRaw,
                model: result.usedModel,
                title: file.name,
                summary: chunks.join(""),
                transcript: extractedText,
                mediaPath: null,
                mediaSize: file.size,
                mediaType: file.type || null,
                metadata: result.insights ? JSON.stringify(result.insights) : null,
              });
            } catch (err) {
              console.error("[summarize-api] history recording failed:", err);
            }
          });
        }

        return c.json(response);
      } catch (err) {
        console.error("[summarize-api] file upload summarize error:", err);
        const classified = classifyError(err);
        return c.json(jsonError(classified.code, classified.message), classified.httpStatus as any);
      }
    }

    // ---- Parse body ----
    let body: SummarizeJsonBody;
    try {
      body = (await c.req.json()) as SummarizeJsonBody;
    } catch {
      return c.json(jsonError("INVALID_INPUT", "Invalid JSON body"), 400);
    }

    // ---- Runtime type + input validation ----
    const validationError = validateBody(body);
    if (validationError) {
      return c.json(validationError.error, validationError.status as any);
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
      `[summarize-api] [${account}] summarize request: mode=${mode} source=${source} length=${lengthRaw}${modelOverride ? ` model=${modelOverride}` : ""}${wantsSSE ? " (SSE)" : ""}`,
    );

    // ========== SSE streaming path ==========
    if (wantsSSE) {
      // Extract-only mode is not supported for SSE streaming
      if (body.extract) {
        return c.json(
          jsonError("INVALID_INPUT", "SSE streaming is not supported for extract-only mode"),
          400,
        );
      }

      const sessionManager = deps.sseSessionManager;
      if (!sessionManager) {
        return c.json(jsonError("SERVER_ERROR", "SSE streaming is not available"), 500);
      }

      const summaryId = randomUUID();
      sessionManager.createSession(summaryId);
      let eventCounter = 0;

      // Helper: push an SSE event to the session buffer and return the ID
      const pushAndBuffer = (event: SseEvent): number => {
        eventCounter++;
        sessionManager.pushEvent(summaryId, event);
        return eventCounter;
      };

      return streamSSE(c, async (stream) => {
        try {
          // Emit init event as the very first SSE event
          const initEvt: SseEvent = { event: "init", data: { summaryId } };
          const initId = pushAndBuffer(initEvt);
          await stream.writeSSE({
            event: "init",
            data: JSON.stringify(initEvt.data),
            id: String(initId),
          });

          const chunks: string[] = [];
          const { sink } = buildSseSink(stream, pushAndBuffer, chunks);

          if (body.url) {
            // URL mode
            const result = await streamSummaryForUrl({
              env: deps.env,
              fetchImpl: fetch,
              input: { url: body.url!, title: null, maxCharacters: null },
              modelOverride,
              promptOverride: null,
              lengthRaw,
              languageRaw: null,
              sink,
              cache: deps.cache,
              mediaCache: deps.mediaCache,
              overrides: DEFAULT_OVERRIDES,
            });

            // Emit metrics event
            const metricsEvt: SseEvent = {
              event: "metrics",
              data: {
                elapsedMs: result.metrics.elapsedMs,
                summary: result.metrics.summary,
                details: result.metrics.details,
                summaryDetailed: result.metrics.summaryDetailed,
                detailsDetailed: result.metrics.detailsDetailed,
                pipeline: result.metrics.pipeline,
              },
            };
            const metricsId = pushAndBuffer(metricsEvt);
            await stream.writeSSE({
              event: "metrics",
              data: JSON.stringify(metricsEvt.data),
              id: String(metricsId),
            });

            // Record history (fire-and-forget) — use summaryId so the SSE
            // done event's ID matches the history row the client needs for chat.
            if (deps.historyStore) {
              const sourceType = detectSourceType(result.insights, true);
              const transcript = result.extracted.content || null;

              let mediaPath: string | null = null;
              let mediaSize: number | null = null;
              let mediaType: string | null = null;
              if (deps.historyMediaPath && deps.mediaCache) {
                try {
                  const mediaEntry = await deps.mediaCache.get({
                    url: body.url!,
                  });
                  if (mediaEntry?.filePath) {
                    const ext = extname(mediaEntry.filePath) || ".bin";
                    const destName = `${summaryId}${ext}`;
                    await mkdir(deps.historyMediaPath, { recursive: true });
                    await copyFile(mediaEntry.filePath, join(deps.historyMediaPath, destName));
                    mediaPath = destName;
                    mediaSize = mediaEntry.sizeBytes;
                    mediaType = mediaEntry.mediaType;
                  }
                } catch (histErr) {
                  console.error("[summarize-api] history media copy failed:", histErr);
                }
              }

              void Promise.resolve().then(() => {
                try {
                  deps.historyStore!.insert({
                    id: summaryId,
                    createdAt: new Date().toISOString(),
                    account,
                    sourceUrl: body.url!,
                    sourceType,
                    inputLength: lengthRaw,
                    model: result.usedModel,
                    title: result.insights?.title ?? null,
                    summary: chunks.join(""),
                    transcript,
                    mediaPath,
                    mediaSize,
                    mediaType,
                    metadata: result.insights ? JSON.stringify(result.insights) : null,
                  });
                } catch (histErr) {
                  console.error("[summarize-api] history recording failed:", histErr);
                }
              });
            }
          } else {
            // Text mode
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

            // Emit metrics event
            const metricsEvt: SseEvent = {
              event: "metrics",
              data: {
                elapsedMs: result.metrics.elapsedMs,
                summary: result.metrics.summary,
                details: result.metrics.details,
                summaryDetailed: result.metrics.summaryDetailed,
                detailsDetailed: result.metrics.detailsDetailed,
                pipeline: result.metrics.pipeline,
              },
            };
            const metricsId = pushAndBuffer(metricsEvt);
            await stream.writeSSE({
              event: "metrics",
              data: JSON.stringify(metricsEvt.data),
              id: String(metricsId),
            });

            // Record history (fire-and-forget, text mode — no media)
            // Use summaryId so the SSE done event ID matches the history row.
            if (deps.historyStore) {
              void Promise.resolve().then(() => {
                try {
                  deps.historyStore!.insert({
                    id: summaryId,
                    createdAt: new Date().toISOString(),
                    account,
                    sourceUrl: null,
                    sourceType: "text",
                    inputLength: lengthRaw,
                    model: result.usedModel,
                    title: null,
                    summary: chunks.join(""),
                    transcript: body.text!,
                    mediaPath: null,
                    mediaSize: null,
                    mediaType: null,
                    metadata: result.insights ? JSON.stringify(result.insights) : null,
                  });
                } catch (histErr) {
                  console.error("[summarize-api] history recording failed:", histErr);
                }
              });
            }
          }

          // Final done event
          const doneEvt = {
            event: "done" as const,
            data: { summaryId: String(summaryId) },
          };
          const doneId = pushAndBuffer(doneEvt);
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify(doneEvt.data),
            id: String(doneId),
          });

          sessionManager.markComplete(summaryId);

          const elapsed = Date.now() - startTime;
          console.log(`[summarize-api] SSE stream complete: summaryId=${summaryId} ${elapsed}ms`);
        } catch (err) {
          console.error("[summarize-api] SSE pipeline error:", err);
          const classified = classifyError(err);
          const errorEvt = {
            event: "error" as const,
            data: { message: classified.message, code: classified.code },
          };
          const errorId = pushAndBuffer(errorEvt);
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify(errorEvt.data),
            id: String(errorId),
          });
        }
      });
    }

    // ========== JSON response path (existing behavior) ==========
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
            summaryId: randomUUID(),
            summary: extracted.content,
            metadata: {
              title: extracted.title ?? null,
              source: body.url,
              model: "none",
              usage: null,
              durationMs: elapsed,
            },
            insights: null,
          };
          return c.json(response);
        }

        // Summarize URL
        const chunks: string[] = [];
        const sink: StreamSink = {
          writeChunk: (text) => chunks.push(text),
          onModelChosen: (model) => console.log(`[summarize-api] model chosen: ${model}`),
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

        const summaryId = randomUUID();
        const response: SummarizeResponse = {
          summaryId,
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
          insights: result.insights,
        };

        // Record history (fire-and-forget)
        if (deps.historyStore) {
          const sourceType = detectSourceType(result.insights, true);
          const transcript = result.extracted.content || null;

          // Copy media before returning (avoid cache eviction race)
          let mediaPath: string | null = null;
          let mediaSize: number | null = null;
          let mediaType: string | null = null;
          if (deps.historyMediaPath && deps.mediaCache) {
            try {
              const mediaEntry = await deps.mediaCache.get({ url: body.url! });
              if (mediaEntry?.filePath) {
                const ext = extname(mediaEntry.filePath) || ".bin";
                const destName = `${summaryId}${ext}`;
                await mkdir(deps.historyMediaPath, { recursive: true });
                await copyFile(mediaEntry.filePath, join(deps.historyMediaPath, destName));
                mediaPath = destName;
                mediaSize = mediaEntry.sizeBytes;
                mediaType = mediaEntry.mediaType;
              }
            } catch (err) {
              console.error("[summarize-api] history media copy failed:", err);
            }
          }

          void Promise.resolve().then(() => {
            try {
              deps.historyStore!.insert({
                id: summaryId,
                createdAt: new Date().toISOString(),
                account,
                sourceUrl: body.url!,
                sourceType,
                inputLength: lengthRaw,
                model: result.usedModel,
                title: result.insights?.title ?? null,
                summary: chunks.join(""),
                transcript,
                mediaPath,
                mediaSize,
                mediaType,
                metadata: result.insights ? JSON.stringify(result.insights) : null,
              });
            } catch (err) {
              console.error("[summarize-api] history recording failed:", err);
            }
          });
        }

        return c.json(response);
      }

      // ---- Text mode ----
      const chunks: string[] = [];
      const sink: StreamSink = {
        writeChunk: (text) => chunks.push(text),
        onModelChosen: (model) => console.log(`[summarize-api] model chosen: ${model}`),
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

      const summaryId = randomUUID();
      const response: SummarizeResponse = {
        summaryId,
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
        insights: result.insights,
      };

      // Record history (fire-and-forget, text mode — no media)
      if (deps.historyStore) {
        void Promise.resolve().then(() => {
          try {
            deps.historyStore!.insert({
              id: summaryId,
              createdAt: new Date().toISOString(),
              account,
              sourceUrl: null,
              sourceType: "text",
              inputLength: lengthRaw,
              model: result.usedModel,
              title: null,
              summary: chunks.join(""),
              transcript: body.text!,
              mediaPath: null,
              mediaSize: null,
              mediaType: null,
              metadata: result.insights ? JSON.stringify(result.insights) : null,
            });
          } catch (err) {
            console.error("[summarize-api] history recording failed:", err);
          }
        });
      }

      return c.json(response);
    } catch (err) {
      console.error("[summarize-api]", err);
      const classified = classifyError(err);
      return c.json(jsonError(classified.code, classified.message), classified.httpStatus as any);
    }
  });

  // ---- GET /summarize/:id/events — SSE reconnection endpoint ----
  route.get("/summarize/:id/events", async (c) => {
    const sessionId = c.req.param("id");
    const sessionManager = deps.sseSessionManager;

    if (!sessionManager) {
      return c.json(jsonError("SERVER_ERROR", "SSE streaming is not available"), 500);
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return c.json(jsonError("NOT_FOUND", "Session not found or expired"), 404);
    }

    const lastEventIdHeader = c.req.header("last-event-id");
    const afterEventId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : 0;
    const bufferedEvents = sessionManager.getEvents(
      sessionId,
      Number.isNaN(afterEventId) ? 0 : afterEventId,
    );

    const isActive = sessionManager.isActive(sessionId);

    return streamSSE(c, async (stream) => {
      const liveQueue: SseEvent[] = [];
      let liveMode = false;
      let nextId = (bufferedEvents.at(-1)?.id ?? 0) + 1;
      let unsub: (() => void) | undefined;

      const streamDone = isActive
        ? new Promise<void>((resolve) => {
            unsub = sessionManager.subscribe(sessionId, (event) => {
              if (!liveMode) {
                liveQueue.push(event);
                if (event.event === "done" || event.event === "error") {
                  unsub?.();
                  resolve();
                }
              } else {
                const writeP = stream.writeSSE({
                  event: event.event,
                  data: JSON.stringify(event.data),
                  id: String(nextId++),
                });
                if (event.event === "done" || event.event === "error") {
                  unsub?.();
                  void writeP.then(() => resolve());
                }
              }
            });
            stream.onAbort(() => {
              unsub?.();
              resolve();
            });
          })
        : null;

      // Replay buffered events
      for (const { id, event } of bufferedEvents) {
        await stream.writeSSE({
          event: event.event,
          data: JSON.stringify(event.data),
          id: String(id),
        });
      }

      // Drain queued live events
      liveMode = true;
      for (const event of liveQueue) {
        await stream.writeSSE({
          event: event.event,
          data: JSON.stringify(event.data),
          id: String(nextId++),
        });
      }

      if (streamDone) await streamDone;
    });
  });

  return route;
}
