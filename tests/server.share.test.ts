import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHistoryStore, type HistoryEntry, type HistoryStore } from "../src/history.js";
import { createHistoryRoute } from "../src/server/routes/history.js";
import { createSharedRoute } from "../src/server/routes/shared.js";

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: "entry-1",
  createdAt: "2026-03-26T10:00:00Z",
  account: "test-user",
  sourceUrl: "https://example.com/article",
  sourceType: "article",
  inputLength: "short",
  model: "test-model",
  title: "Test Article",
  summary: "A summary of the article.",
  transcript: null,
  mediaPath: null,
  mediaSize: null,
  mediaType: null,
  audioPath: null,
  audioSize: null,
  audioType: null,
  metadata: null,
  ...overrides,
});

describe("History share token operations", () => {
  let tmpDir: string;
  let store: HistoryStore;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "share-test-"));
    store = await createHistoryStore({ path: join(tmpDir, "history.sqlite") });
    store.insert(makeEntry());
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("setShareToken stores a token and getByShareToken retrieves the entry", () => {
    const result = store.setShareToken("entry-1", "test-user", "tok_abc123");
    expect(result).toBe(true);

    const entry = store.getByShareToken("tok_abc123");
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("entry-1");
    expect(entry!.summary).toBe("A summary of the article.");
  });

  it("getByShareToken returns null for unknown token", () => {
    const entry = store.getByShareToken("nonexistent-token");
    expect(entry).toBeNull();
  });

  it("clearShareToken removes the token", () => {
    store.setShareToken("entry-1", "test-user", "tok_abc123");
    const cleared = store.clearShareToken("entry-1", "test-user");
    expect(cleared).toBe(true);

    const entry = store.getByShareToken("tok_abc123");
    expect(entry).toBeNull();
  });

  it("clearShareToken returns false for entry without token", () => {
    const cleared = store.clearShareToken("entry-1", "test-user");
    expect(cleared).toBe(false);
  });

  it("getShareToken returns token for shared entry", () => {
    store.setShareToken("entry-1", "test-user", "tok_abc123");
    const token = store.getShareToken("entry-1", "test-user");
    expect(token).toBe("tok_abc123");
  });

  it("getShareToken returns null for non-shared entry", () => {
    const token = store.getShareToken("entry-1", "test-user");
    expect(token).toBeNull();
  });

  it("setShareToken is idempotent (second call returns false, keeps existing)", () => {
    const first = store.setShareToken("entry-1", "test-user", "tok_first");
    expect(first).toBe(true);

    const second = store.setShareToken("entry-1", "test-user", "tok_second");
    expect(second).toBe(false);

    // Original token is preserved
    const token = store.getShareToken("entry-1", "test-user");
    expect(token).toBe("tok_first");
  });

  it("setShareToken fails for wrong account", () => {
    const result = store.setShareToken("entry-1", "other-user", "tok_abc123");
    expect(result).toBe(false);

    const entry = store.getByShareToken("tok_abc123");
    expect(entry).toBeNull();
  });
});

describe("Share API routes", () => {
  let tmpDir: string;
  let store: HistoryStore;
  let app: Hono;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "share-api-test-"));
    store = await createHistoryStore({ path: join(tmpDir, "history.sqlite") });

    const historyRoute = createHistoryRoute({
      historyStore: store,
      historyMediaPath: null,
    });
    const sharedRoute = createSharedRoute({ historyStore: store });

    app = new Hono();

    // Auth middleware only for /v1/history/* (matches production setup)
    app.use("/v1/history/*", async (c, next) => {
      c.set("account", "test-user");
      await next();
    });
    app.use("/v1/history", async (c, next) => {
      c.set("account", "test-user");
      await next();
    });

    app.route("/v1", historyRoute);
    app.route("/v1", sharedRoute);

    // Seed an entry
    store.insert({
      id: "entry-1",
      createdAt: "2026-03-26T10:00:00Z",
      account: "test-user",
      sourceUrl: "https://example.com/article",
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: "Test Article",
      summary: "A summary of the article.",
      transcript: "Full transcript text here.",
      mediaPath: "some/media.mp3",
      mediaSize: 1234,
      mediaType: "audio/mpeg",
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: JSON.stringify({ mediaDurationSeconds: 120, wordCount: 500, costUsd: 0.01 }),
    });
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("POST /v1/history/:id/share creates a token", async () => {
    const res = await app.request("/v1/history/entry-1/share", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.token).toHaveLength(12);
    expect(body.url).toContain(`/share/${body.token}`);
  });

  it("POST /v1/history/:id/share is idempotent", async () => {
    const res1 = await app.request("/v1/history/entry-1/share", { method: "POST" });
    const body1 = await res1.json();

    const res2 = await app.request("/v1/history/entry-1/share", { method: "POST" });
    const body2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(body2.token).toBe(body1.token);
    expect(body2.url).toBe(body1.url);
  });

  it("POST /v1/history/:id/share returns 404 for unknown entry", async () => {
    const res = await app.request("/v1/history/nonexistent/share", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("GET /v1/shared/:token returns public payload with correct fields", async () => {
    // Create share first
    const shareRes = await app.request("/v1/history/entry-1/share", { method: "POST" });
    const { token } = await shareRes.json();

    const res = await app.request(`/v1/shared/${token}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.title).toBe("Test Article");
    expect(body.summary).toBe("A summary of the article.");
    expect(body.sourceUrl).toBe("https://example.com/article");
    expect(body.sourceType).toBe("article");
    expect(body.model).toBe("test-model");
    expect(body.createdAt).toBe("2026-03-26T10:00:00Z");
    expect(body.inputLength).toBe("short");
    expect(body.metadata).toEqual({ mediaDurationSeconds: 120, wordCount: 500 });
  });

  it("GET /v1/shared/:token returns 404 for unknown token", async () => {
    const res = await app.request("/v1/shared/nonexist0001");
    expect(res.status).toBe(404);
  });

  it("public payload does NOT leak id, account, transcript, or mediaPath", async () => {
    const shareRes = await app.request("/v1/history/entry-1/share", { method: "POST" });
    const { token } = await shareRes.json();

    const res = await app.request(`/v1/shared/${token}`);
    const body = await res.json();

    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("account");
    expect(body).not.toHaveProperty("transcript");
    expect(body).not.toHaveProperty("mediaPath");
    expect(body).not.toHaveProperty("mediaSize");
    expect(body).not.toHaveProperty("mediaType");
    expect(body).not.toHaveProperty("audioPath");
    expect(body).not.toHaveProperty("audioSize");
    expect(body).not.toHaveProperty("audioType");
  });

  it("DELETE /v1/history/:id/share revokes token, then GET returns 404", async () => {
    // Share it
    const shareRes = await app.request("/v1/history/entry-1/share", { method: "POST" });
    const { token } = await shareRes.json();

    // Revoke
    const delRes = await app.request("/v1/history/entry-1/share", { method: "DELETE" });
    expect(delRes.status).toBe(204);

    // Public access should now 404
    const getRes = await app.request(`/v1/shared/${token}`);
    expect(getRes.status).toBe(404);
  });

  it("DELETE /v1/history/:id/share returns 404 when not shared", async () => {
    const res = await app.request("/v1/history/entry-1/share", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("GET /v1/history/:id includes sharedToken (null before sharing, string after)", async () => {
    // Before sharing
    const res1 = await app.request("/v1/history/entry-1");
    const body1 = await res1.json();
    expect(body1.sharedToken).toBeNull();

    // Share it
    await app.request("/v1/history/entry-1/share", { method: "POST" });

    // After sharing
    const res2 = await app.request("/v1/history/entry-1");
    const body2 = await res2.json();
    expect(typeof body2.sharedToken).toBe("string");
    expect(body2.sharedToken).toHaveLength(12);
  });

  // --- Public resummarize validation tests ---

  it("POST /v1/shared/:token/resummarize returns 404 for unknown token", async () => {
    const res = await app.request("/v1/shared/nonexist0001/resummarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ length: "short" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("POST /v1/shared/:token/resummarize returns 422 when no transcript", async () => {
    // Insert an entry without a transcript and share it
    store.insert(makeEntry({ id: "no-transcript", transcript: null }));
    store.setShareToken("no-transcript", "test-user", "noTranscrip1");

    const res = await app.request("/v1/shared/noTranscrip1/resummarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ length: "short" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("NO_TRANSCRIPT");
  });

  it("POST /v1/shared/:token/resummarize returns 400 without length", async () => {
    // Share entry-1 (which has a transcript)
    const shareRes = await app.request("/v1/history/entry-1/share", { method: "POST" });
    const { token } = await shareRes.json();

    const res = await app.request(`/v1/shared/${token}/resummarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_LENGTH");
  });
});
