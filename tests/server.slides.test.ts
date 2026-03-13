import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHistoryStore, type HistoryStore } from "../src/history.js";
import { createSlidesRoute } from "../src/server/routes/slides.js";
import { SseSessionManager } from "../src/server/sse-session.js";

describe("Slides API routes", () => {
  let tmpDir: string;
  let store: HistoryStore;
  let sseSessionManager: SseSessionManager;
  let app: Hono;
  let slidesDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "slides-api-test-"));
    slidesDir = join(tmpDir, "slides");
    mkdirSync(slidesDir, { recursive: true });
    store = await createHistoryStore({ path: join(tmpDir, "history.sqlite") });
    sseSessionManager = new SseSessionManager();

    const route = createSlidesRoute({
      env: {
        HOME: tmpDir,
        // No ffmpeg/yt-dlp — tests don't actually extract
      },
      config: null,
      historyStore: store,
      sseSessionManager,
      mediaCache: null,
    });

    app = new Hono();
    // Simulate auth middleware
    app.use("*", async (c, next) => {
      c.set("account", "test-user");
      await next();
    });
    app.route("/v1", route);

    // Seed a video summary entry
    store.insert({
      id: "video-summary-1",
      createdAt: "2026-03-13T10:00:00Z",
      account: "test-user",
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      sourceType: "video",
      inputLength: "medium",
      model: "test-model",
      title: "Test Video",
      summary: "Summary of the test video",
      transcript: "Full transcript...",
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      metadata: null,
    });

    // Seed a text summary (no source URL)
    store.insert({
      id: "text-summary-1",
      createdAt: "2026-03-13T11:00:00Z",
      account: "test-user",
      sourceUrl: null,
      sourceType: "text",
      inputLength: "short",
      model: "test-model",
      title: null,
      summary: "Text summary",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      metadata: null,
    });

    // Seed an article summary (not a video URL)
    store.insert({
      id: "article-summary-1",
      createdAt: "2026-03-13T12:00:00Z",
      account: "test-user",
      sourceUrl: "https://example.com/article",
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: "Test Article",
      summary: "Article summary",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      metadata: null,
    });

    // Seed an entry for another account
    store.insert({
      id: "other-video-1",
      createdAt: "2026-03-13T13:00:00Z",
      account: "other-user",
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      sourceType: "video",
      inputLength: "medium",
      model: "test-model",
      title: "Other's Video",
      summary: "Other's summary",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      metadata: null,
    });
  });

  afterEach(() => {
    store.close();
    sseSessionManager.dispose();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- POST /v1/summarize/:summaryId/slides ----

  describe("POST /v1/summarize/:summaryId/slides", () => {
    it("returns 404 for unknown summary", async () => {
      const res = await app.request("/v1/summarize/nonexistent/slides", { method: "POST" });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 for another account's summary", async () => {
      const res = await app.request("/v1/summarize/other-video-1/slides", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("returns 422 for text summary with no source URL", async () => {
      const res = await app.request("/v1/summarize/text-summary-1/slides", { method: "POST" });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_INPUT");
      expect(body.error.message).toContain("no source URL");
    });

    it("returns 422 for non-video source URL", async () => {
      const res = await app.request("/v1/summarize/article-summary-1/slides", { method: "POST" });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_INPUT");
      expect(body.error.message).toContain("not a supported video type");
    });

    it("returns 500 when ffmpeg is not available", async () => {
      // The default test env has no ffmpeg in PATH
      const res = await app.request("/v1/summarize/video-summary-1/slides", { method: "POST" });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("SERVER_ERROR");
      expect(body.error.message).toContain("ffmpeg");
    });
  });

  // ---- GET /v1/summarize/:summaryId/slides/events ----

  describe("GET /v1/summarize/:summaryId/slides/events", () => {
    it("returns 400 when sessionId is missing", async () => {
      const res = await app.request("/v1/summarize/video-summary-1/slides/events");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 404 for unknown session", async () => {
      const res = await app.request(
        "/v1/summarize/video-summary-1/slides/events?sessionId=no-such-session",
      );
      expect(res.status).toBe(404);
    });

    it("replays buffered events from a valid session", async () => {
      const sessionId = sseSessionManager.createSession();
      sseSessionManager.pushEvent(sessionId, {
        event: "status",
        data: { text: "Slides: preparing source 2%" },
      });
      sseSessionManager.pushEvent(sessionId, {
        event: "done",
        data: { summaryId: "video-summary-1" },
      });

      const res = await app.request(
        `/v1/summarize/video-summary-1/slides/events?sessionId=${sessionId}`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const text = await res.text();
      expect(text).toContain("event: status");
      expect(text).toContain("event: done");
    });
  });

  // ---- GET /v1/slides/:sourceId/:index ----

  describe("GET /v1/slides/:sourceId/:index", () => {
    it("returns placeholder PNG for nonexistent source", async () => {
      const res = await app.request("/v1/slides/youtube-dQw4w9WgXcQ/1");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("x-summarize-slide-ready")).toBe("0");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("returns 404 for invalid index", async () => {
      const res = await app.request("/v1/slides/youtube-dQw4w9WgXcQ/0");
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-numeric index", async () => {
      const res = await app.request("/v1/slides/youtube-dQw4w9WgXcQ/abc");
      expect(res.status).toBe(404);
    });

    it("serves slide image from slides.json manifest", async () => {
      // Set up a fake slides dir under the test HOME's .summarize/slides
      const sourceId = "test-source-abc";
      const sourceDir = join(tmpDir, ".summarize", "slides", sourceId);
      mkdirSync(sourceDir, { recursive: true });

      // Create a fake PNG file (just a few bytes)
      const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const imagePath = join(sourceDir, "slide_0001_abc.png");
      writeFileSync(imagePath, fakePng);

      // Write a slides.json manifest
      const manifest = {
        sourceUrl: "https://example.com/video",
        sourceKind: "direct",
        sourceId,
        slidesDir: sourceDir,
        sceneThreshold: 0.3,
        autoTuneThreshold: true,
        autoTune: { enabled: false, chosenThreshold: 0.3, confidence: 0, strategy: "none" },
        maxSlides: 6,
        minSlideDuration: 2,
        ocrRequested: false,
        ocrAvailable: false,
        slides: [
          {
            index: 1,
            timestamp: 5.0,
            imagePath: "slide_0001_abc.png",
          },
        ],
        warnings: [],
      };
      writeFileSync(join(sourceDir, "slides.json"), JSON.stringify(manifest));

      const res = await app.request(`/v1/slides/${sourceId}/1`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("x-summarize-slide-ready")).toBe("1");
      expect(res.headers.get("cache-control")).toContain("immutable");

      const body = await res.arrayBuffer();
      expect(body.byteLength).toBe(fakePng.length);
    });

    it("falls back to filename pattern when no slides.json exists", async () => {
      const sourceId = "test-source-def";
      const sourceDir = join(tmpDir, ".summarize", "slides", sourceId);
      mkdirSync(sourceDir, { recursive: true });

      const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      writeFileSync(join(sourceDir, "slide_0002_xyz.png"), fakePng);

      const res = await app.request(`/v1/slides/${sourceId}/2`);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-summarize-slide-ready")).toBe("1");
    });

    it("returns placeholder when slide index does not exist in manifest", async () => {
      const sourceId = "test-source-ghi";
      const sourceDir = join(tmpDir, ".summarize", "slides", sourceId);
      mkdirSync(sourceDir, { recursive: true });

      const manifest = {
        sourceUrl: "https://example.com/video",
        sourceKind: "direct",
        sourceId,
        slidesDir: sourceDir,
        sceneThreshold: 0.3,
        autoTuneThreshold: true,
        autoTune: { enabled: false, chosenThreshold: 0.3, confidence: 0, strategy: "none" },
        maxSlides: 6,
        minSlideDuration: 2,
        ocrRequested: false,
        ocrAvailable: false,
        slides: [],
        warnings: [],
      };
      writeFileSync(join(sourceDir, "slides.json"), JSON.stringify(manifest));

      const res = await app.request(`/v1/slides/${sourceId}/99`);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-summarize-slide-ready")).toBe("0");
    });
  });
});
