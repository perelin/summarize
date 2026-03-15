import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { SseEvent, SseSlidesData } from "@steipete/summarize_p2-core/sse";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SummarizeConfig } from "../../config.js";
import type { MediaCache } from "../../content/index.js";
import type { HistoryStore } from "../../history.js";
import { resolveExecutableInPath } from "../../run/env.js";
import {
  extractSlidesForSource,
  resolveSlideSourceFromUrl,
  resolveSlideImagePath,
} from "../../slides/index.js";
import type { SlideExtractionResult } from "../../slides/index.js";
import { resolveSlideSettings, type SlideSettings } from "../../slides/settings.js";
import type { SseSessionManager } from "../sse-session.js";

export type SlidesRouteDeps = {
  env: Record<string, string | undefined>;
  config: SummarizeConfig | null;
  historyStore?: HistoryStore | null;
  sseSessionManager?: SseSessionManager | null;
  mediaCache?: MediaCache | null;
};

type Variables = { account: string };

/** Tiny transparent 1x1 PNG used as a placeholder while slides are still extracting. */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3kq0cAAAAASUVORK5CYII=",
  "base64",
);

function jsonError(code: string, message: string) {
  return { error: { code, message } };
}

function resolveToolPath(
  binary: string,
  env: Record<string, string | undefined>,
  explicitEnvKey?: string,
): string | null {
  const explicit =
    explicitEnvKey && typeof env[explicitEnvKey] === "string" ? env[explicitEnvKey]?.trim() : "";
  if (explicit) return resolveExecutableInPath(explicit, env);
  return resolveExecutableInPath(binary, env);
}

function resolveHomeDir(env: Record<string, string | undefined>): string {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (!home) return process.cwd();
  return home;
}

/**
 * Build the default slides output directory from the environment,
 * mirroring the daemon's `~/.summarize/slides` convention.
 */
function resolveDefaultSlidesDir(env: Record<string, string | undefined>): string {
  return path.resolve(resolveHomeDir(env), ".summarize", "slides");
}

/**
 * Resolve slide settings for the API server.
 * Always enables slides (the caller already decided extraction is wanted).
 */
function resolveServerSlideSettings(
  env: Record<string, string | undefined>,
  config: SummarizeConfig | null,
): SlideSettings {
  const configSlides = config?.slides;
  const outputDir = configSlides?.dir
    ? path.resolve(resolveHomeDir(env), configSlides.dir)
    : resolveDefaultSlidesDir(env);
  const tesseractAvailable = resolveToolPath("tesseract", env, "TESSERACT_PATH") !== null;

  const settings = resolveSlideSettings({
    slides: true,
    slidesOcr: tesseractAvailable && (configSlides?.ocr ?? false),
    slidesDir: outputDir,
    slidesSceneThreshold: configSlides?.sceneThreshold,
    slidesSceneThresholdExplicit: configSlides?.sceneThreshold !== undefined,
    slidesMax: configSlides?.max,
    slidesMinDuration: configSlides?.minDuration,
    cwd: "/", // outputDir is already absolute
  });

  // resolveSlideSettings returns null when disabled, but we forced enabled=true,
  // so this should always succeed. Fallback to sensible defaults just in case.
  return (
    settings ?? {
      enabled: true,
      ocr: false,
      outputDir,
      sceneThreshold: 0.3,
      autoTuneThreshold: true,
      maxSlides: 6,
      minDurationSeconds: 2,
    }
  );
}

function buildSlidesPayload({
  slides,
  baseUrl,
}: {
  slides: SlideExtractionResult;
  baseUrl: string;
}): SseSlidesData {
  return {
    sourceUrl: slides.sourceUrl,
    sourceId: slides.sourceId,
    sourceKind: slides.sourceKind,
    ocrAvailable: slides.ocrAvailable,
    slides: slides.slides.map((slide) => ({
      index: slide.index,
      timestamp: slide.timestamp,
      imageUrl: `${baseUrl}/${slide.index}${
        typeof slide.imageVersion === "number" && slide.imageVersion > 0
          ? `?v=${slide.imageVersion}`
          : ""
      }`,
      ocrText: slide.ocrText ?? null,
      ocrConfidence: slide.ocrConfidence ?? null,
    })),
  };
}

export function createSlidesRoute(deps: SlidesRouteDeps): Hono<{ Variables: Variables }> {
  const route = new Hono<{ Variables: Variables }>();

  // ---- POST /summarize/:summaryId/slides — trigger slide extraction ----
  route.post("/summarize/:summaryId/slides", async (c) => {
    const account = c.get("account") as string;
    const summaryId = c.req.param("summaryId");

    if (!deps.historyStore) {
      return c.json(jsonError("SERVER_ERROR", "History store is not available"), 500);
    }

    const sessionManager = deps.sseSessionManager;
    if (!sessionManager) {
      return c.json(jsonError("SERVER_ERROR", "SSE streaming is not available"), 500);
    }

    // Load the summary from history
    const entry = deps.historyStore.getById(summaryId, account);
    if (!entry) {
      return c.json(jsonError("NOT_FOUND", "Summary not found"), 404);
    }

    if (!entry.sourceUrl) {
      return c.json(
        jsonError("INVALID_INPUT", "Summary has no source URL — slides require a video source"),
        422,
      );
    }

    // Resolve the slide source from the URL
    const source = resolveSlideSourceFromUrl(entry.sourceUrl);
    if (!source) {
      return c.json(
        jsonError("INVALID_INPUT", "Source URL is not a supported video type for slide extraction"),
        422,
      );
    }

    const settings = resolveServerSlideSettings(deps.env, deps.config);
    const sessionId = sessionManager.createSession();

    const ffmpegPath = resolveToolPath("ffmpeg", deps.env, "FFMPEG_PATH");
    const ytDlpPath = resolveToolPath("yt-dlp", deps.env, "YT_DLP_PATH");
    const tesseractPath = resolveToolPath("tesseract", deps.env, "TESSERACT_PATH");

    if (!ffmpegPath) {
      sessionManager.destroySession(sessionId);
      return c.json(jsonError("SERVER_ERROR", "ffmpeg is not available on this server"), 500);
    }

    console.log(
      `[summarize-api] [${account}] slides extraction: summaryId=${summaryId} source=${source.url} kind=${source.kind} sessionId=${sessionId}`,
    );

    const pushEvent = (event: SseEvent): void => {
      sessionManager.pushEvent(sessionId, event);
    };

    // Determine the base URL for slide images.
    // Use the request's host to build absolute URLs.
    const proto = c.req.header("x-forwarded-proto") ?? "http";
    const host = c.req.header("host") ?? "localhost";
    const slideImageBaseUrl = `${proto}://${host}/v1/slides/${source.sourceId}`;

    // Fire-and-forget: run extraction in the background
    void (async () => {
      try {
        const result = await extractSlidesForSource({
          source,
          settings,
          mediaCache: deps.mediaCache ?? null,
          env: deps.env,
          timeoutMs: 300_000,
          ytDlpPath,
          ffmpegPath,
          tesseractPath,
          hooks: {
            onSlidesProgress: (text) => {
              pushEvent({ event: "status", data: { text } });
            },
            onSlideChunk: ({ slide }) => {
              pushEvent({
                event: "status",
                data: { text: `Slide ${slide.index} extracted` },
              });
            },
            onSlidesTimeline: (slides) => {
              // Full result available (possibly from cache)
              const payload = buildSlidesPayload({ slides, baseUrl: slideImageBaseUrl });
              pushEvent({ event: "slides", data: payload });
            },
          },
        });

        // If onSlidesTimeline wasn't called (non-cached path), emit the final slides event
        const hasSlides = sessionManager
          .getEvents(sessionId)
          .some((e) => e.event.event === "slides");
        if (!hasSlides) {
          const payload = buildSlidesPayload({ slides: result, baseUrl: slideImageBaseUrl });
          pushEvent({ event: "slides", data: payload });
        }

        console.log(
          `[summarize-api] slides extraction complete: summaryId=${summaryId} slides=${result.slides.length}`,
        );

        pushEvent({
          event: "done",
          data: { summaryId },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Slide extraction failed";
        console.error(`[summarize-api] slides extraction error: summaryId=${summaryId}`, err);
        pushEvent({
          event: "error",
          data: { message, code: "SLIDES_EXTRACTION_FAILED" },
        });
      }
    })();

    return c.json({ ok: true, sessionId, sourceId: source.sourceId });
  });

  // ---- GET /summarize/:summaryId/slides/events — SSE stream for slide extraction progress ----
  route.get("/summarize/:summaryId/slides/events", async (c) => {
    const sessionId = c.req.query("sessionId");
    const sessionManager = deps.sseSessionManager;

    if (!sessionManager) {
      return c.json(jsonError("SERVER_ERROR", "SSE streaming is not available"), 500);
    }

    if (!sessionId) {
      return c.json(jsonError("INVALID_INPUT", "sessionId query parameter is required"), 400);
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return c.json(jsonError("NOT_FOUND", "Session not found or expired"), 404);
    }

    const lastEventIdHeader = c.req.header("last-event-id");
    const afterEventId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : 0;
    const events = sessionManager.getEvents(
      sessionId,
      Number.isNaN(afterEventId) ? 0 : afterEventId,
    );

    return streamSSE(c, async (stream) => {
      for (const { id, event } of events) {
        await stream.writeSSE({
          event: event.event,
          data: JSON.stringify(event.data),
          id: String(id),
        });
      }
    });
  });

  // ---- GET /slides/:sourceId/:index — serve a slide image ----
  route.get("/slides/:sourceId/:index", async (c) => {
    const sourceId = c.req.param("sourceId");
    const indexRaw = c.req.param("index");
    const index = Number(indexRaw);

    if (!sourceId || !Number.isFinite(index) || index <= 0) {
      return c.json(jsonError("NOT_FOUND", "Invalid slide reference"), 404);
    }

    const slidesRoot = resolveDefaultSlidesDir(deps.env);
    const slidesDir = path.join(slidesRoot, sourceId);
    // Prevent path traversal — resolved path must stay within slidesRoot
    if (!slidesDir.startsWith(slidesRoot + path.sep)) {
      return c.json(jsonError("NOT_FOUND", "Invalid slide reference"), 404);
    }
    const payloadPath = path.join(slidesDir, "slides.json");

    // Try to resolve the image from the slides.json manifest first
    const resolveFromDisk = async (): Promise<string | null> => {
      const raw = await fs.readFile(payloadPath, "utf8").catch(() => null);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as SlideExtractionResult;
          const slide = parsed?.slides?.find?.((item) => item?.index === index);
          if (slide?.imagePath) {
            const resolved = resolveSlideImagePath(slidesDir, slide.imagePath);
            if (resolved) return resolved;
          }
        } catch {
          // fall through to filename pattern fallback
        }
      }

      // Fallback: match by filename pattern (slide_NNNN_*.png)
      const prefix = `slide_${String(index).padStart(4, "0")}`;
      const entries = await fs.readdir(slidesDir).catch(() => null);
      if (!entries) return null;
      const candidates = entries
        .filter((name) => name.startsWith(prefix) && name.endsWith(".png"))
        .map((name) => path.join(slidesDir, name));
      if (candidates.length === 0) return null;

      // Pick the most recently modified file
      let best: { filePath: string; mtimeMs: number } | null = null;
      for (const filePath of candidates) {
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat?.isFile()) continue;
        if (!best || stat.mtimeMs > best.mtimeMs) best = { filePath, mtimeMs: stat.mtimeMs };
      }
      return best?.filePath ?? null;
    };

    const filePath = await resolveFromDisk();

    if (!filePath) {
      // Return a transparent 1x1 PNG placeholder to avoid broken-image icons
      // while extraction is still in progress.
      c.header("Content-Type", "image/png");
      c.header("Content-Length", PLACEHOLDER_PNG.length.toString());
      c.header("Cache-Control", "no-store");
      c.header("X-Summarize-Slide-Ready", "0");
      return c.body(PLACEHOLDER_PNG);
    }

    try {
      const stat = await fs.stat(filePath);
      const stream = createReadStream(filePath);
      const webStream = Readable.toWeb(stream) as ReadableStream;

      return new Response(webStream, {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": stat.size.toString(),
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Summarize-Slide-Ready": "1",
        },
      });
    } catch {
      return c.json(jsonError("NOT_FOUND", "Slide image not found"), 404);
    }
  });

  return route;
}
