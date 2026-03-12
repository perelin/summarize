import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import * as summarizeMod from "../src/daemon/summarize.js";
import { createSummarizeRoute } from "../src/server/routes/summarize.js";

const fakeDeps = {
  env: {},
  config: null,
  cache: { mode: "bypass", store: null, ttlMs: 0, maxBytes: 0, path: null } as any,
  mediaCache: null,
};

function createTestApp() {
  const app = new Hono();
  const route = createSummarizeRoute(fakeDeps);
  app.route("/v1", route);
  return app;
}

describe("POST /v1/summarize – input validation", () => {
  it("rejects empty JSON body with 400 INVALID_INPUT", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects invalid length with 400", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", length: "bogus" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("Invalid length");
  });

  it("rejects non-http URL (ftp://) with 400", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "ftp://example.com/file" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects invalid JSON with 400", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });
});

describe("POST /v1/summarize – error classification", () => {
  function createTestApp() {
    const app = new Hono();
    const route = createSummarizeRoute(fakeDeps);
    app.route("/v1", route);
    return app;
  }

  function postUrl(app: Hono, url = "https://example.com") {
    return app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  }

  function postText(app: Hono, text = "hello world") {
    return app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }

  it("returns FETCH_FAILED with HTTP status for fetch errors", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForUrl").mockRejectedValueOnce(
      new Error("Failed to fetch HTML document (status 403)"),
    );
    const res = await postUrl(createTestApp());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("FETCH_FAILED");
    expect(body.error.message).toContain("403");
    expect(body.error.message).toContain("blocking automated access");
  });

  it("returns FETCH_FAILED with 404 hint", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForUrl").mockRejectedValueOnce(
      new Error("Failed to fetch HTML document (status 404)"),
    );
    const res = await postUrl(createTestApp());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("FETCH_FAILED");
    expect(body.error.message).toContain("page not found");
  });

  it("returns TIMEOUT for timeout errors", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForUrl").mockRejectedValueOnce(
      new Error("Fetching HTML document timed out"),
    );
    const res = await postUrl(createTestApp());
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error.code).toBe("TIMEOUT");
  });

  it("returns UNSUPPORTED_CONTENT for content-type errors", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForUrl").mockRejectedValueOnce(
      new Error("Unsupported content-type for HTML document fetch: application/pdf"),
    );
    const res = await postUrl(createTestApp());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_CONTENT");
  });

  it("returns TRANSCRIPTION_FAILED for transcription errors", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForUrl").mockRejectedValueOnce(
      new Error("Failed to transcribe Spotify episode"),
    );
    const res = await postUrl(createTestApp());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("TRANSCRIPTION_FAILED");
  });

  it("returns CONTENT_BLOCKED for captcha/blocked errors", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForUrl").mockRejectedValueOnce(
      new Error("Spotify embed HTML looked blocked (captcha)"),
    );
    const res = await postUrl(createTestApp());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("CONTENT_BLOCKED");
  });

  it("returns FETCH_FAILED for X/Twitter errors", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForUrl").mockRejectedValueOnce(
      new Error("Unable to fetch tweet content from X."),
    );
    const res = await postUrl(createTestApp());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("FETCH_FAILED");
    expect(body.error.message).toContain("X/Twitter");
  });

  it("returns generic SERVER_ERROR for unknown errors", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForUrl").mockRejectedValueOnce(
      new Error("something completely unexpected"),
    );
    const res = await postUrl(createTestApp());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_ERROR");
    expect(body.error.message).toBe("Internal server error");
  });

  it("classifies text mode errors too", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForVisiblePage").mockRejectedValueOnce(
      new Error("Request timed out after 300s"),
    );
    const res = await postText(createTestApp());
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error.code).toBe("TIMEOUT");
  });
});

describe("POST /v1/summarize – insights in response", () => {
  it("returns insights for URL mode", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForUrl").mockResolvedValueOnce({
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
    } as any);

    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insights).toBeDefined();
    expect(body.insights.title).toBe("Test Article");
    expect(body.insights.wordCount).toBe(1500);
    expect(body.insights.costUsd).toBe(0.0042);
    expect(body.insights.cacheStatus).toBe("miss");
    expect(body.insights.extractionMethod).toBe("html");
    expect(body.insights.summaryFromCache).toBe(false);
    expect(body.insights.stages).toHaveLength(1);
  });

  it("returns sparse insights for text mode", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForVisiblePage").mockResolvedValueOnce({
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
        summary: "",
        details: null,
        summaryDetailed: "",
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
    } as any);

    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello world test" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insights).toBeDefined();
    expect(body.insights.wordCount).toBe(5);
    expect(body.insights.costUsd).toBe(0.001);
    expect(body.insights.extractionMethod).toBeNull();
  });
});
