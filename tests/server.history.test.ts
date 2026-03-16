import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHistoryStore, type HistoryStore } from "../src/history.js";
import { createHistoryRoute } from "../src/server/routes/history.js";

describe("History API routes", () => {
  let tmpDir: string;
  let store: HistoryStore;
  let app: Hono;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "history-api-test-"));
    store = await createHistoryStore({ path: join(tmpDir, "history.sqlite") });
    const route = createHistoryRoute({
      historyStore: store,
      historyMediaPath: join(tmpDir, "media"),
    });
    app = new Hono();
    // Simulate auth middleware
    app.use("*", async (c, next) => {
      c.set("account", "test-user");
      await next();
    });
    app.route("/v1", route);

    // Seed data (with account)
    store.insert({
      id: "entry-1",
      createdAt: "2026-03-12T10:00:00Z",
      account: "test-user",
      sourceUrl: "https://example.com/1",
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: "First Article",
      summary: "Summary 1",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: JSON.stringify({ costUsd: 0.001 }),
    });
    store.insert({
      id: "entry-2",
      createdAt: "2026-03-12T11:00:00Z",
      account: "test-user",
      sourceUrl: "https://example.com/2",
      sourceType: "podcast",
      inputLength: "medium",
      model: "test-model",
      title: "Podcast Episode",
      summary: "Summary 2",
      transcript: "Full transcript...",
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

  it("GET /v1/history returns paginated list", async () => {
    const res = await app.request("/v1/history");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].id).toBe("entry-2"); // most recent first
    expect(body.entries[0].title).toBe("Podcast Episode");
  });

  it("GET /v1/history respects limit and offset", async () => {
    const res = await app.request("/v1/history?limit=1&offset=1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].id).toBe("entry-1");
  });

  it("GET /v1/history caps limit at 100", async () => {
    const res = await app.request("/v1/history?limit=999");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(100);
  });

  it("GET /v1/history/:id returns full entry with transcript", async () => {
    const res = await app.request("/v1/history/entry-2");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("entry-2");
    expect(body.transcript).toBe("Full transcript...");
    expect(body.hasMedia).toBe(false);
  });

  it("GET /v1/history/:id returns 404 for missing entry", async () => {
    const res = await app.request("/v1/history/nope");
    expect(res.status).toBe(404);
  });

  it("DELETE /v1/history/:id deletes entry", async () => {
    const res = await app.request("/v1/history/entry-1", { method: "DELETE" });
    expect(res.status).toBe(204);
    const check = await app.request("/v1/history/entry-1");
    expect(check.status).toBe(404);
  });

  it("DELETE /v1/history/:id returns 404 for missing entry", async () => {
    const res = await app.request("/v1/history/nope", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("GET /v1/history does not show other accounts' entries", async () => {
    store.insert({
      id: "other-entry",
      createdAt: "2026-03-12T12:00:00Z",
      account: "other-user",
      sourceUrl: "https://example.com/other",
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: "Other's Article",
      summary: "Other summary",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: null,
    });

    const res = await app.request("/v1/history");
    const body = await res.json();
    expect(body.total).toBe(2); // only test-user's entries
    expect(body.entries.every((e: { id: string }) => e.id !== "other-entry")).toBe(true);
  });

  it("GET /v1/history/:id returns 404 for other account's entry", async () => {
    store.insert({
      id: "other-entry",
      createdAt: "2026-03-12T12:00:00Z",
      account: "other-user",
      sourceUrl: "https://example.com/other",
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: "Other's Article",
      summary: "Other summary",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: null,
    });

    const res = await app.request("/v1/history/other-entry");
    expect(res.status).toBe(404);
  });

  it("DELETE /v1/history/:id returns 404 for other account's entry", async () => {
    store.insert({
      id: "other-entry",
      createdAt: "2026-03-12T12:00:00Z",
      account: "other-user",
      sourceUrl: "https://example.com/other",
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: "Other's Article",
      summary: "Other summary",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: null,
    });

    const res = await app.request("/v1/history/other-entry", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("GET /v1/history/:id/media returns 404 for other account's media", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const mediaDir = join(tmpDir, "media");
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(join(mediaDir, "other.mp3"), "fake-audio");

    store.insert({
      id: "other-media-entry",
      createdAt: "2026-03-12T12:00:00Z",
      account: "other-user",
      sourceUrl: "https://example.com/podcast",
      sourceType: "podcast",
      inputLength: "medium",
      model: "test-model",
      title: "Other's Podcast",
      summary: "Other podcast summary",
      transcript: null,
      mediaPath: "other.mp3",
      mediaSize: 10,
      mediaType: "audio/mpeg",
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: null,
    });

    const res = await app.request("/v1/history/other-media-entry/media");
    expect(res.status).toBe(404);
  });
});
