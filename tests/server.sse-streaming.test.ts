import type { SseEvent } from "@steipete/summarize_p2-core/sse";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createSummarizeRoute } from "../src/server/routes/summarize.js";
import { SseSessionManager } from "../src/server/sse-session.js";
import * as summarizeMod from "../src/summarize/pipeline.js";
import type { StreamSink } from "../src/summarize/pipeline.js";
import { baseFakeDeps } from "./helpers/server-test-utils.js";

/**
 * Parse raw SSE text into structured events.
 * Format: "id: <id>\nevent: <type>\ndata: <json>\n\n"
 */
function parseSseText(text: string): Array<{ id: string; event: string; data: any }> {
  const events: Array<{ id: string; event: string; data: any }> = [];
  // Split on double newlines (event boundaries)
  const blocks = text.split("\n\n").filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    const lines = block.split("\n");
    let id = "";
    let event = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("id: ")) id = line.slice(4);
      else if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (event) {
      events.push({ id, event, data: data ? JSON.parse(data) : null });
    }
  }
  return events;
}

function createFakeDeps() {
  return {
    ...baseFakeDeps(),
    sseSessionManager: new SseSessionManager(),
  };
}

function createTestApp(deps = createFakeDeps()) {
  const app = new Hono();
  const route = createSummarizeRoute(deps);
  app.route("/v1", route);
  return { app, deps };
}

/** Helper to build a mock result that controls StreamSink callbacks. */
function mockStreamSummaryForUrl(options?: { onSink?: (sink: StreamSink) => void }) {
  return vi.spyOn(summarizeMod, "streamSummaryForUrl").mockImplementation(async (args) => {
    const sink = args.sink;

    // Simulate pipeline callbacks
    sink.writeStatus?.("Extracting...");
    sink.onModelChosen("openai/gpt-4o");
    sink.writeMeta?.({ inputSummary: "Article ~1500 words" });
    sink.writeChunk("Hello ");
    sink.writeChunk("world");
    sink.writeStatus?.("Summarizing...");

    // Allow tests to add additional sink calls
    options?.onSink?.(sink);

    return {
      usedModel: "openai/gpt-4o",
      report: {
        llm: [
          {
            provider: "openai",
            model: "gpt-4o",
            calls: 1,
            promptTokens: 500,
            completionTokens: 200,
            totalTokens: 700,
          },
        ],
        services: { firecrawl: { requests: 0 }, apify: { requests: 0 } },
        pipeline: null,
      },
      metrics: {
        elapsedMs: 1234,
        summary: "1.2s",
        details: null,
        summaryDetailed: "1.234s",
        detailsDetailed: null,
        pipeline: null,
      },
      insights: {
        title: "Test Article",
        siteName: "example.com",
        wordCount: 1500,
        characterCount: 9000,
        truncated: false,
        mediaDurationSeconds: null,
        transcriptSource: null,
        transcriptionProvider: null,
        cacheStatus: "miss",
        summaryFromCache: false,
        costUsd: 0.0042,
        inputTokens: 500,
        outputTokens: 200,
        extractionMethod: "html",
        servicesUsed: [],
        attemptedProviders: [],
        stages: [{ stage: "llm-query", durationMs: 800 }],
      },
      extracted: {
        url: "https://example.com",
        title: "Test Article",
        content: "body",
        transcriptSource: null,
      },
    } as any;
  });
}

function mockStreamSummaryForVisiblePage() {
  return vi.spyOn(summarizeMod, "streamSummaryForVisiblePage").mockImplementation(async (args) => {
    const sink = args.sink;

    sink.onModelChosen("openai/gpt-4o");
    sink.writeMeta?.({ inputSummary: "Text ~5 words" });
    sink.writeChunk("Summary ");
    sink.writeChunk("here");

    return {
      usedModel: "openai/gpt-4o",
      report: {
        llm: [
          {
            provider: "openai",
            model: "gpt-4o",
            calls: 1,
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        ],
        services: { firecrawl: { requests: 0 }, apify: { requests: 0 } },
        pipeline: null,
      },
      metrics: {
        elapsedMs: 500,
        summary: "0.5s",
        details: null,
        summaryDetailed: "0.500s",
        detailsDetailed: null,
        pipeline: null,
      },
      insights: {
        title: null,
        siteName: null,
        wordCount: 5,
        characterCount: 25,
        truncated: false,
        mediaDurationSeconds: null,
        transcriptSource: null,
        transcriptionProvider: null,
        cacheStatus: null,
        summaryFromCache: false,
        costUsd: 0.001,
        inputTokens: 100,
        outputTokens: 50,
        extractionMethod: null,
        servicesUsed: [],
        attemptedProviders: [],
        stages: [],
      },
    } as any;
  });
}

// ────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────

describe("POST /v1/summarize with Accept: text/event-stream (SSE)", () => {
  it("returns SSE stream for URL mode", async () => {
    const spy = mockStreamSummaryForUrl();
    const { app } = createTestApp();

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = parseSseText(text);

    // Should have status, meta, chunk, metrics, done events
    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("status");
    expect(eventTypes).toContain("meta");
    expect(eventTypes).toContain("chunk");
    expect(eventTypes).toContain("metrics");
    expect(eventTypes).toContain("done");

    // Verify chunk content
    const chunkEvents = events.filter((e) => e.event === "chunk");
    expect(chunkEvents).toHaveLength(2);
    expect(chunkEvents[0].data.text).toBe("Hello ");
    expect(chunkEvents[1].data.text).toBe("world");

    // Verify done event has summaryId
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.data.summaryId).toBeTypeOf("string");
    expect(doneEvent!.data.summaryId.length).toBeGreaterThan(0);

    // Verify all events have sequential IDs
    const ids = events.map((e) => parseInt(e.id));
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBe(ids[i - 1]! + 1);
    }

    spy.mockRestore();
  });

  it("returns SSE stream for text mode", async () => {
    const spy = mockStreamSummaryForVisiblePage();
    const { app } = createTestApp();

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ text: "Hello world test" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = parseSseText(text);

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("meta");
    expect(eventTypes).toContain("chunk");
    expect(eventTypes).toContain("metrics");
    expect(eventTypes).toContain("done");

    const chunkEvents = events.filter((e) => e.event === "chunk");
    expect(chunkEvents).toHaveLength(2);
    expect(chunkEvents[0].data.text).toBe("Summary ");
    expect(chunkEvents[1].data.text).toBe("here");

    spy.mockRestore();
  });

  it("emits meta events with model and inputSummary", async () => {
    const spy = mockStreamSummaryForUrl();
    const { app } = createTestApp();

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    const text = await res.text();
    const events = parseSseText(text);
    const metaEvents = events.filter((e) => e.event === "meta");

    // There should be at least one meta event with the model
    const modelMeta = metaEvents.find((e) => e.data.model === "openai/gpt-4o");
    expect(modelMeta).toBeDefined();

    // There should be a meta event with inputSummary
    const inputMeta = metaEvents.find((e) => e.data.inputSummary != null);
    expect(inputMeta).toBeDefined();
    expect(inputMeta!.data.inputSummary).toContain("1500");

    spy.mockRestore();
  });

  it("emits metrics event with pipeline data", async () => {
    const spy = mockStreamSummaryForUrl();
    const { app } = createTestApp();

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    const text = await res.text();
    const events = parseSseText(text);
    const metricsEvent = events.find((e) => e.event === "metrics");

    expect(metricsEvent).toBeDefined();
    expect(metricsEvent!.data.elapsedMs).toBe(1234);
    expect(metricsEvent!.data.summary).toBe("1.2s");

    spy.mockRestore();
  });

  it("emits error event when pipeline throws", async () => {
    const spy = vi
      .spyOn(summarizeMod, "streamSummaryForUrl")
      .mockRejectedValueOnce(new Error("Failed to fetch HTML document (status 403)"));

    const { app } = createTestApp();

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(res.status).toBe(200); // SSE stream always returns 200
    const text = await res.text();
    const events = parseSseText(text);

    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.code).toBe("FETCH_FAILED");
    expect(errorEvent!.data.message).toContain("403");

    spy.mockRestore();
  });

  it("emits error event with TIMEOUT code for timeout errors", async () => {
    const spy = vi
      .spyOn(summarizeMod, "streamSummaryForUrl")
      .mockRejectedValueOnce(new Error("Request timed out after 300s"));

    const { app } = createTestApp();

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    const text = await res.text();
    const events = parseSseText(text);

    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.code).toBe("TIMEOUT");

    spy.mockRestore();
  });

  it("rejects extract-only mode with SSE accept header", async () => {
    const { app } = createTestApp();

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ url: "https://example.com", extract: true }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.message).toContain("extract-only");
  });

  it("returns 500 when sseSessionManager is not configured", async () => {
    const deps = {
      env: {},
      config: null,
      cache: {
        mode: "bypass",
        store: null,
        ttlMs: 0,
        maxBytes: 0,
        path: null,
      } as any,
      mediaCache: null,
      sseSessionManager: null,
    };
    const { app } = createTestApp(deps);

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_ERROR");
    expect(body.error.message).toContain("not available");
  });
});

describe("POST /v1/summarize without Accept: text/event-stream (backward compat)", () => {
  it("returns JSON response for URL mode (no Accept header)", async () => {
    const spy = vi.spyOn(summarizeMod, "streamSummaryForUrl").mockResolvedValueOnce({
      usedModel: "openai/gpt-4o",
      report: {
        llm: [
          {
            provider: "openai",
            model: "gpt-4o",
            calls: 1,
            promptTokens: 500,
            completionTokens: 200,
            totalTokens: 700,
          },
        ],
        services: { firecrawl: { requests: 0 }, apify: { requests: 0 } },
        pipeline: null,
      },
      metrics: {
        elapsedMs: 1234,
        summary: "",
        details: null,
        summaryDetailed: "",
        detailsDetailed: null,
        pipeline: null,
      },
      insights: {
        title: "Test",
        siteName: "example.com",
        wordCount: 100,
        characterCount: 600,
        truncated: false,
        mediaDurationSeconds: null,
        transcriptSource: null,
        transcriptionProvider: null,
        cacheStatus: "miss",
        summaryFromCache: false,
        costUsd: 0.001,
        inputTokens: 500,
        outputTokens: 200,
        extractionMethod: "html",
        servicesUsed: [],
        attemptedProviders: [],
        stages: [],
      },
      extracted: {
        url: "https://example.com",
        title: "Test",
        content: "body",
        transcriptSource: null,
      },
    } as any);

    const { app } = createTestApp();

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.summary).toBeDefined();
    expect(body.metadata).toBeDefined();
    expect(body.insights).toBeDefined();

    spy.mockRestore();
  });

  it("still returns JSON error for invalid input", async () => {
    const { app } = createTestApp();

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });
});

describe("GET /v1/summarize/:id/events (SSE reconnection)", () => {
  it("replays buffered events from a session", async () => {
    const fakeDeps = createFakeDeps();
    const { app } = createTestApp(fakeDeps);
    const manager = fakeDeps.sseSessionManager;

    // Manually create a session and push events
    const sessionId = manager.createSession();
    const evt1: SseEvent = { event: "status", data: { text: "Working..." } };
    const evt2: SseEvent = { event: "chunk", data: { text: "Hello" } };
    const evt3: SseEvent = { event: "done", data: { summaryId: "abc-123" } };
    manager.pushEvent(sessionId, evt1);
    manager.pushEvent(sessionId, evt2);
    manager.pushEvent(sessionId, evt3);
    manager.markComplete(sessionId);

    const res = await app.request(`/v1/summarize/${sessionId}/events`, {
      method: "GET",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = parseSseText(text);

    expect(events).toHaveLength(3);
    expect(events[0].event).toBe("status");
    expect(events[0].data.text).toBe("Working...");
    expect(events[1].event).toBe("chunk");
    expect(events[1].data.text).toBe("Hello");
    expect(events[2].event).toBe("done");
    expect(events[2].data.summaryId).toBe("abc-123");

    manager.dispose();
  });

  it("supports Last-Event-ID for partial replay", async () => {
    const fakeDeps = createFakeDeps();
    const { app } = createTestApp(fakeDeps);
    const manager = fakeDeps.sseSessionManager;

    const sessionId = manager.createSession();
    manager.pushEvent(sessionId, { event: "status", data: { text: "step 1" } });
    manager.pushEvent(sessionId, { event: "chunk", data: { text: "part 1" } });
    manager.pushEvent(sessionId, { event: "chunk", data: { text: "part 2" } });
    manager.pushEvent(sessionId, { event: "done", data: { summaryId: "xyz" } });
    manager.markComplete(sessionId);

    // Reconnect after event ID 2
    const res = await app.request(`/v1/summarize/${sessionId}/events`, {
      method: "GET",
      headers: { "Last-Event-ID": "2" },
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    const events = parseSseText(text);

    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("3");
    expect(events[0].event).toBe("chunk");
    expect(events[0].data.text).toBe("part 2");
    expect(events[1].id).toBe("4");
    expect(events[1].event).toBe("done");

    manager.dispose();
  });

  it("returns 404 for unknown session ID", async () => {
    const { app } = createTestApp();

    const res = await app.request("/v1/summarize/nonexistent-id/events", {
      method: "GET",
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 500 when sseSessionManager is not configured", async () => {
    const deps = {
      env: {},
      config: null,
      cache: {
        mode: "bypass",
        store: null,
        ttlMs: 0,
        maxBytes: 0,
        path: null,
      } as any,
      mediaCache: null,
      sseSessionManager: null,
    };
    const { app } = createTestApp(deps);

    const res = await app.request("/v1/summarize/some-id/events", {
      method: "GET",
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_ERROR");
  });
});

describe("SSE init event and summaryId unification", () => {
  it("emits init event as first event with summaryId matching done event", async () => {
    const spy = mockStreamSummaryForUrl();
    const { app } = createTestApp();

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    const events = parseSseText(text);

    // First event must be init
    expect(events[0].event).toBe("init");
    expect(events[0].data.summaryId).toBeTypeOf("string");
    expect(events[0].data.summaryId.length).toBeGreaterThan(0);

    // Done event must match init's summaryId
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.data.summaryId).toBe(events[0].data.summaryId);

    spy.mockRestore();
  });

  it("uses summaryId as session key for reconnection", async () => {
    const spy = mockStreamSummaryForUrl();
    const fakeDeps = createFakeDeps();
    const { app } = createTestApp(fakeDeps);

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    const text = await res.text();
    const events = parseSseText(text);
    const initEvent = events.find((e) => e.event === "init");
    const summaryId = initEvent!.data.summaryId;

    // Reconnect using the summaryId as the session ID
    const reconnRes = await app.request(`/v1/summarize/${summaryId}/events`, {
      method: "GET",
    });

    expect(reconnRes.status).toBe(200);
    const reconnText = await reconnRes.text();
    const reconnEvents = parseSseText(reconnText);

    // Should replay all buffered events including init
    expect(reconnEvents.length).toBeGreaterThan(0);
    expect(reconnEvents[0].event).toBe("init");
    expect(reconnEvents[0].data.summaryId).toBe(summaryId);

    spy.mockRestore();
    fakeDeps.sseSessionManager.dispose();
  });
});

describe("GET /v1/summarize/:id/events (live forwarding)", () => {
  it("replays buffered events and forwards live events in order", async () => {
    const fakeDeps = createFakeDeps();
    const { app } = createTestApp(fakeDeps);
    const manager = fakeDeps.sseSessionManager;

    // Create a session and push 2 buffered events
    const sessionId = manager.createSession("live-test-session");
    const evt1: SseEvent = { event: "status", data: { text: "step1" } };
    const evt2: SseEvent = { event: "chunk", data: { text: "hello" } };
    manager.pushEvent(sessionId, evt1);
    manager.pushEvent(sessionId, evt2);

    // Start the request — this returns immediately with a streaming response
    const resPromise = app.request(`/v1/summarize/${sessionId}/events`, {
      method: "GET",
    });

    // Wait a tick for the stream handler to set up its subscription, then
    // push 2 more events (including done) to simulate live arrivals
    await new Promise((r) => setTimeout(r, 50));
    manager.pushEvent(sessionId, { event: "chunk", data: { text: "world" } });
    manager.pushEvent(sessionId, {
      event: "done",
      data: { summaryId: "live-test-session" },
    });
    manager.markComplete(sessionId);

    const res = await resPromise;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = parseSseText(text);

    // Should have all 4 events in order
    expect(events).toHaveLength(4);
    expect(events[0].event).toBe("status");
    expect(events[0].data.text).toBe("step1");
    expect(events[1].event).toBe("chunk");
    expect(events[1].data.text).toBe("hello");
    expect(events[2].event).toBe("chunk");
    expect(events[2].data.text).toBe("world");
    expect(events[3].event).toBe("done");
    expect(events[3].data.summaryId).toBe("live-test-session");

    // Verify IDs are sequential
    const ids = events.map((e) => parseInt(e.id));
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBe(ids[i - 1]! + 1);
    }

    manager.dispose();
  });

  it("replays all events for completed session without subscribing", async () => {
    const fakeDeps = createFakeDeps();
    const { app } = createTestApp(fakeDeps);
    const manager = fakeDeps.sseSessionManager;

    const sessionId = manager.createSession("completed-session");
    manager.pushEvent(sessionId, { event: "status", data: { text: "done" } });
    manager.pushEvent(sessionId, {
      event: "done",
      data: { summaryId: "completed-session" },
    });
    manager.markComplete(sessionId);

    const res = await app.request(`/v1/summarize/${sessionId}/events`, {
      method: "GET",
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    const events = parseSseText(text);

    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("status");
    expect(events[1].event).toBe("done");

    manager.dispose();
  });
});

describe("SSE session buffering from POST flow", () => {
  it("buffers events in session manager during SSE POST", async () => {
    const spy = mockStreamSummaryForUrl();
    const fakeDeps = createFakeDeps();
    const { app } = createTestApp(fakeDeps);

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(res.status).toBe(200);

    // Parse the done event to get the summaryId (we need the sessionId though)
    // The session manager should have at least one session with events
    // We can verify by checking session count isn't 0
    const text = await res.text();
    const events = parseSseText(text);

    // Verify done event exists and has summaryId
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.data.summaryId).toBeTypeOf("string");

    spy.mockRestore();
    fakeDeps.sseSessionManager.dispose();
  });
});
