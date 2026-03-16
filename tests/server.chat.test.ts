import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChatStore, type ChatStore } from "../src/chat-store.js";
import { createHistoryStore, type HistoryStore } from "../src/history.js";
import { createChatRoute } from "../src/server/routes/chat.js";
import { SseSessionManager } from "../src/server/sse-session.js";

/**
 * Create a minimal chat route test app.
 *
 * The streamWebChatResponse calls LLM APIs, so we only test the route layer
 * (validation, history/chat store integration, SSE structure) — the POST /chat
 * tests that actually stream are limited to what we can test without live models.
 */
function createTestApp({
  historyStore,
  chatStore,
  sseSessionManager,
}: {
  historyStore: HistoryStore;
  chatStore: ChatStore;
  sseSessionManager: SseSessionManager;
}) {
  const route = createChatRoute({
    env: {},
    config: null,
    historyStore,
    chatStore,
    sseSessionManager,
  });
  const app = new Hono();
  // Simulate auth middleware
  app.use("*", async (c, next) => {
    c.set("account", "test-user");
    await next();
  });
  app.route("/v1", route);
  return app;
}

describe("Chat API routes", () => {
  let tmpDir: string;
  let historyStore: HistoryStore;
  let chatStore: ChatStore;
  let sseSessionManager: SseSessionManager;
  let app: Hono;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "chat-api-test-"));
    historyStore = await createHistoryStore({ path: join(tmpDir, "history.sqlite") });
    chatStore = await createChatStore({ path: join(tmpDir, "chat.sqlite") });
    sseSessionManager = new SseSessionManager();
    app = createTestApp({ historyStore, chatStore, sseSessionManager });

    // Seed a history entry
    historyStore.insert({
      id: "summary-1",
      createdAt: "2026-03-13T10:00:00Z",
      account: "test-user",
      sourceUrl: "https://example.com/article",
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: "Test Article",
      summary: "This is a test summary about a test article.",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: null,
    });

    // Seed a history entry for a different account
    historyStore.insert({
      id: "summary-other",
      createdAt: "2026-03-13T10:00:00Z",
      account: "other-user",
      sourceUrl: "https://example.com/other",
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: "Other Article",
      summary: "Other summary.",
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
    sseSessionManager.dispose();
    chatStore.close();
    historyStore.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // =====================
  // GET /v1/chat/history
  // =====================

  describe("GET /v1/chat/history", () => {
    it("returns empty messages for a summary with no chat", async () => {
      const res = await app.request("/v1/chat/history?summaryId=summary-1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.summaryId).toBe("summary-1");
      expect(body.messages).toEqual([]);
    });

    it("returns chat messages in chronological order", async () => {
      chatStore.insert({
        id: "msg-1",
        summaryId: "summary-1",
        account: "test-user",
        role: "user",
        content: "What is this about?",
        model: null,
        createdAt: "2026-03-13T10:01:00Z",
      });
      chatStore.insert({
        id: "msg-2",
        summaryId: "summary-1",
        account: "test-user",
        role: "assistant",
        content: "This is about a test article.",
        model: "gpt-4",
        createdAt: "2026-03-13T10:01:05Z",
      });

      const res = await app.request("/v1/chat/history?summaryId=summary-1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("user");
      expect(body.messages[0].content).toBe("What is this about?");
      expect(body.messages[0].createdAt).toBe("2026-03-13T10:01:00Z");
      expect(body.messages[1].role).toBe("assistant");
      expect(body.messages[1].content).toBe("This is about a test article.");
      expect(body.messages[1].createdAt).toBe("2026-03-13T10:01:05Z");
    });

    it("returns 400 when summaryId is missing", async () => {
      const res = await app.request("/v1/chat/history");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 404 for non-existent summary", async () => {
      const res = await app.request("/v1/chat/history?summaryId=does-not-exist");
      expect(res.status).toBe(404);
    });

    it("returns 404 for another account's summary", async () => {
      const res = await app.request("/v1/chat/history?summaryId=summary-other");
      expect(res.status).toBe(404);
    });

    it("does not return other accounts' chat messages", async () => {
      chatStore.insert({
        id: "msg-other",
        summaryId: "summary-1",
        account: "other-user",
        role: "user",
        content: "Other user message",
        model: null,
        createdAt: "2026-03-13T10:05:00Z",
      });
      chatStore.insert({
        id: "msg-mine",
        summaryId: "summary-1",
        account: "test-user",
        role: "user",
        content: "My message",
        model: null,
        createdAt: "2026-03-13T10:06:00Z",
      });

      const res = await app.request("/v1/chat/history?summaryId=summary-1");
      const body = await res.json();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].content).toBe("My message");
    });
  });

  // =====================
  // POST /v1/chat — validation
  // =====================

  describe("POST /v1/chat (validation)", () => {
    it("rejects invalid JSON", async () => {
      const res = await app.request("/v1/chat", {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_INPUT");
    });

    it("rejects missing summaryId", async () => {
      const res = await app.request("/v1/chat", {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_INPUT");
      expect(body.error.message).toContain("summaryId");
    });

    it("rejects missing message", async () => {
      const res = await app.request("/v1/chat", {
        method: "POST",
        body: JSON.stringify({ summaryId: "summary-1" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_INPUT");
      expect(body.error.message).toContain("message");
    });

    it("rejects empty message", async () => {
      const res = await app.request("/v1/chat", {
        method: "POST",
        body: JSON.stringify({ summaryId: "summary-1", message: "   " }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 404 for non-existent summary", async () => {
      const res = await app.request("/v1/chat", {
        method: "POST",
        body: JSON.stringify({ summaryId: "does-not-exist", message: "hello" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for another account's summary", async () => {
      const res = await app.request("/v1/chat", {
        method: "POST",
        body: JSON.stringify({ summaryId: "summary-other", message: "hello" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(404);
    });
  });

  // =====================
  // GET /v1/chat/:id/events — SSE reconnection
  // =====================

  describe("GET /v1/chat/:id/events", () => {
    it("returns 404 for non-existent session", async () => {
      const res = await app.request("/v1/chat/nonexistent/events");
      expect(res.status).toBe(404);
    });

    it("returns buffered events for valid session", async () => {
      const sessionId = sseSessionManager.createSession();
      sseSessionManager.pushEvent(sessionId, {
        event: "chunk",
        data: { text: "hello" },
      });
      sseSessionManager.pushEvent(sessionId, {
        event: "done",
        data: { summaryId: "summary-1" },
      });

      const res = await app.request(`/v1/chat/${sessionId}/events`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("event: chunk");
      expect(text).toContain("hello");
      expect(text).toContain("event: done");
    });

    it("respects Last-Event-ID header for reconnection", async () => {
      const sessionId = sseSessionManager.createSession();
      sseSessionManager.pushEvent(sessionId, {
        event: "chunk",
        data: { text: "first" },
      });
      sseSessionManager.pushEvent(sessionId, {
        event: "chunk",
        data: { text: "second" },
      });
      sseSessionManager.pushEvent(sessionId, {
        event: "done",
        data: { summaryId: "summary-1" },
      });

      // Ask for events after ID 1 (skip the first chunk)
      const res = await app.request(`/v1/chat/${sessionId}/events`, {
        headers: { "last-event-id": "1" },
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain("first");
      expect(text).toContain("second");
      expect(text).toContain("event: done");
    });
  });
});

// =====================
// Chat store unit tests
// =====================

describe("ChatStore", () => {
  let tmpDir: string;
  let store: ChatStore;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "chat-store-test-"));
    store = await createChatStore({ path: join(tmpDir, "chat.sqlite") });
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("inserts and retrieves messages", () => {
    store.insert({
      id: "m1",
      summaryId: "s1",
      account: "alice",
      role: "user",
      content: "Hello",
      model: null,
      createdAt: "2026-03-13T10:00:00Z",
    });
    store.insert({
      id: "m2",
      summaryId: "s1",
      account: "alice",
      role: "assistant",
      content: "Hi there",
      model: "gpt-4",
      createdAt: "2026-03-13T10:00:01Z",
    });

    const messages = store.listBySummaryId("s1", "alice");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Hi there");
    expect(messages[1].model).toBe("gpt-4");
  });

  it("isolates messages by account", () => {
    store.insert({
      id: "m1",
      summaryId: "s1",
      account: "alice",
      role: "user",
      content: "Alice's message",
      model: null,
      createdAt: "2026-03-13T10:00:00Z",
    });
    store.insert({
      id: "m2",
      summaryId: "s1",
      account: "bob",
      role: "user",
      content: "Bob's message",
      model: null,
      createdAt: "2026-03-13T10:00:01Z",
    });

    const alice = store.listBySummaryId("s1", "alice");
    expect(alice).toHaveLength(1);
    expect(alice[0].content).toBe("Alice's message");

    const bob = store.listBySummaryId("s1", "bob");
    expect(bob).toHaveLength(1);
    expect(bob[0].content).toBe("Bob's message");
  });

  it("isolates messages by summaryId", () => {
    store.insert({
      id: "m1",
      summaryId: "s1",
      account: "alice",
      role: "user",
      content: "For summary 1",
      model: null,
      createdAt: "2026-03-13T10:00:00Z",
    });
    store.insert({
      id: "m2",
      summaryId: "s2",
      account: "alice",
      role: "user",
      content: "For summary 2",
      model: null,
      createdAt: "2026-03-13T10:00:01Z",
    });

    const s1 = store.listBySummaryId("s1", "alice");
    expect(s1).toHaveLength(1);
    expect(s1[0].content).toBe("For summary 1");
  });

  it("returns messages in chronological order", () => {
    store.insert({
      id: "m1",
      summaryId: "s1",
      account: "alice",
      role: "user",
      content: "First",
      model: null,
      createdAt: "2026-03-13T10:00:00Z",
    });
    store.insert({
      id: "m3",
      summaryId: "s1",
      account: "alice",
      role: "user",
      content: "Third",
      model: null,
      createdAt: "2026-03-13T10:00:02Z",
    });
    store.insert({
      id: "m2",
      summaryId: "s1",
      account: "alice",
      role: "assistant",
      content: "Second",
      model: "gpt-4",
      createdAt: "2026-03-13T10:00:01Z",
    });

    const messages = store.listBySummaryId("s1", "alice");
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe("First");
    expect(messages[1].content).toBe("Second");
    expect(messages[2].content).toBe("Third");
  });

  it("returns empty array for unknown summaryId", () => {
    const messages = store.listBySummaryId("does-not-exist", "alice");
    expect(messages).toEqual([]);
  });
});
