import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHistoryStore, type HistoryStore } from "../src/history.js";
import { createResummarizeRoute } from "../src/server/routes/resummarize.js";

describe("POST /v1/history/:id/resummarize", () => {
  let tmpDir: string;
  let store: HistoryStore;
  let app: Hono;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "resummarize-test-"));
    store = await createHistoryStore({ path: join(tmpDir, "history.sqlite") });
    const route = createResummarizeRoute({
      env: {},
      config: null,
      cache: { summaryDir: null, extractDir: null },
      mediaCache: null,
      historyStore: store,
    });
    app = new Hono();
    app.use("*", async (c, next) => {
      c.set("account", "test-user");
      await next();
    });
    app.route("/v1", route);

    // Seed an entry with transcript
    store.insert({
      id: "has-transcript",
      createdAt: "2026-03-25T10:00:00Z",
      account: "test-user",
      sourceUrl: "https://example.com/article",
      sourceType: "article",
      inputLength: "medium",
      model: "test-model",
      title: "Test Article",
      summary: "Original summary.",
      transcript: "This is the full extracted text for the article.",
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: null,
    });

    // Seed an entry without transcript
    store.insert({
      id: "no-transcript",
      createdAt: "2026-03-25T11:00:00Z",
      account: "test-user",
      sourceUrl: "https://example.com/2",
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: "No Transcript",
      summary: "Summary only.",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: null,
    });
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 404 for non-existent entry", async () => {
    const res = await app.request("/v1/history/nope/resummarize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ length: "long" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 422 when entry has no transcript", async () => {
    const res = await app.request("/v1/history/no-transcript/resummarize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ length: "long" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("NO_TRANSCRIPT");
  });

  it("returns 400 when length is missing", async () => {
    const res = await app.request("/v1/history/has-transcript/resummarize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_LENGTH");
  });

  it("returns 400 for invalid length value", async () => {
    const res = await app.request("/v1/history/has-transcript/resummarize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ length: "huge" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_LENGTH");
  });

  it("returns 406 when Accept header does not include text/event-stream", async () => {
    const res = await app.request("/v1/history/has-transcript/resummarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ length: "long" }),
    });
    expect(res.status).toBe(406);
    const body = await res.json();
    expect(body.error.code).toBe("SSE_REQUIRED");
  });
});
