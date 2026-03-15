# Persistent Process URLs — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every summarization process a canonical URL (`/s/{id}`) from the moment it starts, enabling reload resilience, shareability, and bookmarkability.

**Architecture:** Server emits a new `init` SSE event with the `summaryId` at stream start. Client updates the browser URL via `history.pushState`. A new `ProcessView` component handles both in-progress reconnection and completed summary display. The `SseSessionManager` gains a pub/sub mechanism so reconnecting clients receive live events. Hash-based routing is replaced with path-based routing.

**Tech Stack:** Preact, Hono, SSE, History API

**Spec:** `docs/superpowers/specs/2026-03-14-persistent-process-urls-design.md`

---

## Chunk 1: Server-Side Foundation

### Task 1: Extend SseSessionManager with subscribe/isActive/markComplete

**Files:**

- Modify: `src/server/sse-session.ts`
- Test: `tests/server.sse-session.test.ts`

- [ ] **Step 1: Write failing tests for `createSession(id)` with custom ID**

Add to `tests/server.sse-session.test.ts`:

```ts
it("accepts a custom session ID", () => {
  const customId = "my-custom-id-123";
  const id = manager.createSession(customId);
  expect(id).toBe(customId);
  const session = manager.getSession(id);
  expect(session).toBeDefined();
  expect(session!.id).toBe(customId);
});

it("still generates an ID when none is provided", () => {
  const id = manager.createSession();
  expect(id).toBeTypeOf("string");
  expect(id.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/server.sse-session.test.ts`
Expected: FAIL — `createSession` does not accept arguments

- [ ] **Step 3: Implement custom ID support in `createSession`**

In `src/server/sse-session.ts`, change:

```ts
/** Create a new session and return its ID. Accepts an optional custom ID. */
createSession(id?: string): string {
  const sessionId = id ?? crypto.randomUUID();
  const session: SseSession = {
    id: sessionId,
    events: [],
    createdAt: Date.now(),
    totalBytes: 0,
  };
  this.sessions.set(sessionId, session);
  return sessionId;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/server.sse-session.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for `isActive` and `markComplete`**

Add to `tests/server.sse-session.test.ts`:

```ts
it("isActive returns true for a new session", () => {
  const id = manager.createSession();
  expect(manager.isActive(id)).toBe(true);
});

it("isActive returns false after markComplete", () => {
  const id = manager.createSession();
  manager.pushEvent(id, { event: "chunk", data: { text: "hello" } });
  manager.markComplete(id);
  expect(manager.isActive(id)).toBe(false);
});

it("isActive returns false for unknown session", () => {
  expect(manager.isActive("nonexistent")).toBe(false);
});

it("isActive returns false for expired session", () => {
  const id = manager.createSession();
  vi.advanceTimersByTime(15 * 60 * 1000 + 1);
  expect(manager.isActive(id)).toBe(false);
});

it("markComplete silently ignores unknown session", () => {
  expect(() => manager.markComplete("nonexistent")).not.toThrow();
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm vitest run tests/server.sse-session.test.ts`
Expected: FAIL — `isActive` and `markComplete` do not exist

- [ ] **Step 7: Implement `isActive` and `markComplete`**

In `src/server/sse-session.ts`, add a `completed` field to `SseSession`:

```ts
export interface SseSession {
  id: string;
  events: Array<{ id: number; event: SseEvent }>;
  createdAt: number;
  totalBytes: number;
  completed: boolean;
}
```

Update `createSession` to set `completed: false`.

Add methods:

```ts
/** Returns true if the session exists, is not expired, and has not been marked complete. */
isActive(sessionId: string): boolean {
  const session = this.getSession(sessionId);
  if (!session) return false;
  return !session.completed;
}

/** Mark a session as complete. The session remains in the buffer for reconnectors. */
markComplete(sessionId: string): void {
  const session = this.sessions.get(sessionId);
  if (session) session.completed = true;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run tests/server.sse-session.test.ts`
Expected: PASS

- [ ] **Step 9: Write failing tests for `subscribe`**

Add to `tests/server.sse-session.test.ts`:

```ts
it("subscribe receives new events pushed after subscription", () => {
  const id = manager.createSession();
  manager.pushEvent(id, { event: "status", data: { text: "before" } });

  const received: SseEvent[] = [];
  manager.subscribe(id, (event) => received.push(event));

  manager.pushEvent(id, { event: "chunk", data: { text: "after1" } });
  manager.pushEvent(id, { event: "chunk", data: { text: "after2" } });

  expect(received).toHaveLength(2);
  expect(received[0]).toEqual({ event: "chunk", data: { text: "after1" } });
  expect(received[1]).toEqual({ event: "chunk", data: { text: "after2" } });
});

it("subscribe returns an unsubscribe function", () => {
  const id = manager.createSession();
  const received: SseEvent[] = [];
  const unsub = manager.subscribe(id, (event) => received.push(event));

  manager.pushEvent(id, { event: "chunk", data: { text: "first" } });
  unsub();
  manager.pushEvent(id, { event: "chunk", data: { text: "second" } });

  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({ event: "chunk", data: { text: "first" } });
});

it("subscribe throws for unknown session", () => {
  expect(() => manager.subscribe("nonexistent", () => {})).toThrow();
});

it("multiple subscribers receive the same events", () => {
  const id = manager.createSession();
  const received1: SseEvent[] = [];
  const received2: SseEvent[] = [];

  manager.subscribe(id, (event) => received1.push(event));
  manager.subscribe(id, (event) => received2.push(event));

  manager.pushEvent(id, { event: "chunk", data: { text: "shared" } });

  expect(received1).toHaveLength(1);
  expect(received2).toHaveLength(1);
});

it("cleanup removes subscribers for expired sessions", () => {
  const id = manager.createSession();
  const received: SseEvent[] = [];
  manager.subscribe(id, (event) => received.push(event));

  vi.advanceTimersByTime(15 * 60 * 1000 + 1);
  // Trigger cleanup
  vi.advanceTimersByTime(60 * 1000);

  // Session is gone; push should no-op
  manager.pushEvent(id, { event: "chunk", data: { text: "late" } });
  expect(received).toHaveLength(0);
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `pnpm vitest run tests/server.sse-session.test.ts`
Expected: FAIL — `subscribe` does not exist

- [ ] **Step 11: Implement `subscribe`**

In `src/server/sse-session.ts`, add a subscribers map:

```ts
private subscribers = new Map<string, Set<(event: SseEvent) => void>>();
```

Add the `subscribe` method:

```ts
/**
 * Subscribe to new events for a session. Returns an unsubscribe function.
 * Throws if the session does not exist.
 */
subscribe(sessionId: string, callback: (event: SseEvent) => void): () => void {
  const session = this.getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  if (!this.subscribers.has(sessionId)) {
    this.subscribers.set(sessionId, new Set());
  }
  this.subscribers.get(sessionId)!.add(callback);

  return () => {
    const subs = this.subscribers.get(sessionId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) this.subscribers.delete(sessionId);
    }
  };
}
```

Update `pushEvent` to notify subscribers:

```ts
pushEvent(sessionId: string, event: SseEvent): void {
  const session = this.sessions.get(sessionId);
  if (!session) return;

  // Buffer the event (if under cap)
  if (session.totalBytes < BUFFER_CAP_BYTES) {
    const eventBytes = JSON.stringify(event).length;
    session.events.push({ id: session.events.length + 1, event });
    session.totalBytes += eventBytes;
  }

  // Notify subscribers
  const subs = this.subscribers.get(sessionId);
  if (subs) {
    for (const cb of subs) {
      cb(event);
    }
  }
}
```

Update `cleanup` to remove subscriber sets for expired sessions:

```ts
private cleanup(): void {
  for (const [id, session] of this.sessions) {
    if (this.isExpired(session)) {
      this.sessions.delete(id);
      this.subscribers.delete(id);
    }
  }
}
```

Also update `destroySession`:

```ts
destroySession(sessionId: string): void {
  this.sessions.delete(sessionId);
  this.subscribers.delete(sessionId);
}
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `pnpm vitest run tests/server.sse-session.test.ts`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add src/server/sse-session.ts tests/server.sse-session.test.ts
git commit -m "feat(server): add subscribe/isActive/markComplete to SseSessionManager"
```

---

### Task 2: Unify summaryId and sessionId, emit `init` event

**Files:**

- Modify: `src/server/routes/summarize.ts`
- Test: `tests/server.sse-streaming.test.ts`

- [ ] **Step 1: Write failing test for `init` event**

Add to `tests/server.sse-streaming.test.ts` (using the existing `parseSseText` helper and `createFakeDeps`):

```ts
it("emits init event as the first SSE event with summaryId", async () => {
  // Mock the pipeline to produce minimal output
  vi.spyOn(summarizeMod, "runSummarizePipeline").mockImplementation(
    async (_input, _env, _config, _cache, sink) => {
      sink.writeStatus("working");
      sink.writeChunk("hello");
      return {
        summary: "hello",
        model: "test-model",
        usage: { inputTokens: 10, outputTokens: 5 },
        durationMs: 100,
        title: null,
        insights: null,
        sourceText: null,
      };
    },
  );

  const deps = createFakeDeps();
  const route = createSummarizeRoute(deps);
  const app = new Hono();
  app.route("/v1", route);

  const res = await app.request("/v1/summarize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ url: "https://example.com", length: "short" }),
  });

  expect(res.status).toBe(200);
  const text = await res.text();
  const events = parseSseText(text);

  // First event must be init
  expect(events.length).toBeGreaterThanOrEqual(1);
  expect(events[0].event).toBe("init");
  expect(events[0].data.summaryId).toBeTypeOf("string");
  expect(events[0].data.summaryId.length).toBeGreaterThan(0);

  // The summaryId in init must match the one in done
  const doneEvent = events.find((e) => e.event === "done");
  expect(doneEvent).toBeDefined();
  expect(doneEvent!.data.summaryId).toBe(events[0].data.summaryId);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.sse-streaming.test.ts`
Expected: FAIL — first event is not `init`

- [ ] **Step 3: Implement `init` event and unified IDs**

In `src/server/routes/summarize.ts`, around line 272-281, change:

```ts
// Before:
const summaryId = randomUUID();
const sessionId = sessionManager.createSession();
let eventCounter = 0;

const pushAndBuffer = (event: SseEvent): number => {
  eventCounter++;
  sessionManager.pushEvent(sessionId, event);
  return eventCounter;
};

return streamSSE(c, async (stream) => {
```

To:

```ts
const summaryId = randomUUID();
// Use summaryId as the session ID — one ID for both history and SSE buffer
sessionManager.createSession(summaryId);
let eventCounter = 0;

const pushAndBuffer = (event: SseEvent): number => {
  eventCounter++;
  sessionManager.pushEvent(summaryId, event);
  return eventCounter;
};

return streamSSE(c, async (stream) => {
  // Emit init event as the very first event
  const initEvt: SseEvent = { event: "init", data: { summaryId } };
  const initId = pushAndBuffer(initEvt);
  await stream.writeSSE({
    event: "init",
    data: JSON.stringify({ summaryId }),
    id: String(initId),
  });
```

Update the `SseEvent` union in `packages/core/src/shared/sse-events.ts`:

1. Add the init variant to the union (line 79-86):

```ts
export type SseEvent =
  | { event: "init"; data: { summaryId: string } }
  | { event: "meta"; data: SseMetaData }
  | { event: "slides"; data: SseSlidesData }
  | { event: "status"; data: { text: string } }
  | { event: "chunk"; data: { text: string } }
  | { event: "metrics"; data: SseMetricsData }
  | { event: "done"; data: { summaryId: string } }
  | { event: "error"; data: { message: string; code?: string } };
```

2. Add `init` case to `parseSseEvent()` (line 94-113):

```ts
case "init":
  return { event: "init", data: JSON.parse(message.data) as { summaryId: string } };
```

Remove the `as any` cast on the init event creation in the summarize handler — it's now a proper `SseEvent` variant.

Update all remaining references to `sessionId` in the SSE handler to use `summaryId`. The specific references to change:

- Line 273: `const sessionId = sessionManager.createSession();` → remove, replaced by `sessionManager.createSession(summaryId);`
- Line 279: `sessionManager.pushEvent(sessionId, event);` → `sessionManager.pushEvent(summaryId, event);`

After the `done` event is emitted, call `sessionManager.markComplete(summaryId)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/server.sse-streaming.test.ts`
Expected: PASS

- [ ] **Step 5: Run full server test suite to check for regressions**

Run: `pnpm vitest run tests/server.*.test.ts`
Expected: PASS (all existing tests still pass)

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/summarize.ts packages/core/src/shared/sse-events.ts tests/server.sse-streaming.test.ts
git commit -m "feat(server): emit init SSE event with summaryId, unify session and summary IDs"
```

---

### Task 3: Update reconnection endpoint to support live forwarding

**Files:**

- Modify: `src/server/routes/summarize.ts` (the `GET /summarize/:id/events` handler, lines 780-817)
- Test: `tests/server.sse-streaming.test.ts`

- [ ] **Step 1: Write failing test for live-forwarding reconnection**

Add to `tests/server.sse-streaming.test.ts`:

```ts
it("reconnection endpoint replays buffered events and forwards live events", async () => {
  const deps = createFakeDeps();
  const mgr = deps.sseSessionManager;

  // Create a session and push some events
  const id = mgr.createSession("test-session");
  mgr.pushEvent(id, { event: "status", data: { text: "step 1" } });
  mgr.pushEvent(id, { event: "chunk", data: { text: "hello " } });

  const route = createSummarizeRoute(deps);
  const app = new Hono();
  app.route("/v1", route);

  // Start reconnection request
  const resPromise = app.request(`/v1/summarize/test-session/events`, {
    method: "GET",
    headers: { Accept: "text/event-stream" },
  });

  // Push more events after a short delay (simulating ongoing processing)
  setTimeout(() => {
    mgr.pushEvent(id, { event: "chunk", data: { text: "world" } });
    mgr.pushEvent(id, { event: "done", data: { summaryId: "test-session" } });
    mgr.markComplete(id);
  }, 50);

  const res = await resPromise;
  expect(res.status).toBe(200);
  const text = await res.text();
  const events = parseSseText(text);

  // Should have all 4 events: 2 buffered + 2 live
  expect(events).toHaveLength(4);
  expect(events[0].event).toBe("status");
  expect(events[1].event).toBe("chunk");
  expect(events[2].event).toBe("chunk");
  expect(events[3].event).toBe("done");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.sse-streaming.test.ts`
Expected: FAIL — reconnection endpoint only returns 2 buffered events

- [ ] **Step 3: Implement live-forwarding reconnection**

Replace the `GET /summarize/:id/events` handler in `src/server/routes/summarize.ts`:

```ts
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

  // Check active status synchronously, before entering the async stream callback
  const isActive = sessionManager.isActive(sessionId);

  return streamSSE(c, async (stream) => {
    // CORRECTNESS: subscribe() MUST be called before the first await to
    // avoid a race between getEvents() (called above) and subscribe().
    // Node.js is single-threaded, so synchronous calls can't interleave.
    // Events arriving during the async replay are queued, then drained.
    const liveQueue: SseEvent[] = [];
    let liveMode = false;
    let nextId = (bufferedEvents.at(-1)?.id ?? 0) + 1;
    let unsub: (() => void) | undefined;
    let resolveWhenDone: (() => void) | undefined;

    const streamDone = isActive
      ? new Promise<void>((resolve) => {
          resolveWhenDone = resolve;
          unsub = sessionManager.subscribe(sessionId, (event) => {
            if (!liveMode) {
              liveQueue.push(event); // queued during replay
            } else {
              void stream.writeSSE({
                event: event.event,
                data: JSON.stringify(event.data),
                id: String(nextId++),
              });
            }
            if (event.event === "done" || event.event === "error") {
              unsub?.();
              resolve();
            }
          });
          stream.onAbort(() => {
            unsub?.();
            resolve();
          });
        })
      : null;

    // 1. Replay buffered events
    for (const { id, event } of bufferedEvents) {
      await stream.writeSSE({
        event: event.event,
        data: JSON.stringify(event.data),
        id: String(id),
      });
    }

    // 2. Drain events that arrived during replay (in correct order)
    liveMode = true;
    for (const event of liveQueue) {
      await stream.writeSSE({
        event: event.event,
        data: JSON.stringify(event.data),
        id: String(nextId++),
      });
    }

    // 3. Wait for live stream to complete (or client disconnect)
    if (streamDone) await streamDone;
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/server.sse-streaming.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/summarize.ts tests/server.sse-streaming.test.ts
git commit -m "feat(server): reconnection endpoint now forwards live events via subscribe"
```

---

### Task 4: Add SPA catch-all route

**Files:**

- Modify: `src/server/index.ts`
- Test: `tests/server.health.test.ts` (or a new `tests/server.spa.test.ts`)

- [ ] **Step 1: Write failing test for SPA catch-all**

Create `tests/server.spa.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/index.js";

function createMinimalDeps() {
  return {
    accounts: [{ name: "test", tokens: ["test-token"] }],
    env: {},
    config: null,
    cache: { mode: "bypass", store: null, ttlMs: 0, maxBytes: 0, path: null } as any,
    mediaCache: null,
    historyStore: null,
    historyMediaPath: null,
    chatStore: null,
  };
}

describe("SPA catch-all", () => {
  it("serves index.html for /s/some-uuid path", async () => {
    const app = createApp(createMinimalDeps() as any);
    const res = await app.request("/s/abc-123-def");
    // Returns 200 if frontend is built, 503 if not. Either proves the
    // catch-all matched (not a 404).
    expect(res.status).not.toBe(404);
    const text = await res.text();
    // Should be HTML or the "not built" message — never a JSON error
    expect(text).toMatch(/<!DOCTYPE html|Frontend not built/);
  });

  it("serves index.html for /history path", async () => {
    const app = createApp(createMinimalDeps() as any);
    const res = await app.request("/history");
    expect(res.status).not.toBe(404);
    const text = await res.text();
    expect(text).toMatch(/<!DOCTYPE html|Frontend not built/);
  });

  it("does NOT intercept /v1/* API routes", async () => {
    const app = createApp(createMinimalDeps() as any);
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
  });

  it("does NOT intercept /assets/* static files", async () => {
    const app = createApp(createMinimalDeps() as any);
    const res = await app.request("/assets/nonexistent.js");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.spa.test.ts`
Expected: FAIL — `/s/abc-123-def` returns 404

- [ ] **Step 3: Implement SPA catch-all**

In `src/server/index.ts`, add after all route registrations (before `app.onError`):

```ts
// SPA catch-all: serve index.html for any path not matched by API or static routes.
// This enables path-based client-side routing (e.g., /s/:id, /history).
// Hono only reaches this handler if no previous route matched, so /v1/* and
// /assets/* paths are already handled and never reach here.
app.get("*", (c) => {
  if (isDev && existsSync(indexHtmlPath)) {
    return c.html(readFileSync(indexHtmlPath, "utf-8"));
  }
  if (indexHtml) return c.html(indexHtml);
  return c.text("Frontend not built. Run: pnpm -C apps/web build", 503);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/server.spa.test.ts`
Expected: PASS

- [ ] **Step 5: Run full server test suite**

Run: `pnpm vitest run tests/server.*.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts tests/server.spa.test.ts
git commit -m "feat(server): add SPA catch-all route for path-based client routing"
```

---

## Chunk 2: Client-Side Routing & URL Updates

### Task 5: Replace hash router with path-based router

**Files:**

- Modify: `apps/web/src/lib/router.ts`

- [ ] **Step 1: Implement path-based router with `Link` component and hash compat**

Replace `apps/web/src/lib/router.ts` entirely:

```ts
import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

export type Route =
  | { view: "summarize" }
  | { view: "history" }
  | { view: "summary"; id: string };

/** Custom event name dispatched by navigate() to trigger re-renders. */
const NAV_EVENT = "app:navigate";

function parsePath(pathname: string): Route {
  if (pathname === "/history") return { view: "history" };
  const summaryMatch = pathname.match(/^\/s\/([^/]+)$/);
  if (summaryMatch) return { view: "summary", id: summaryMatch[1] };
  return { view: "summarize" };
}

/**
 * One-time hash-to-path migration.
 * Converts legacy hash routes to path equivalents via replaceState.
 */
function migrateHashRoute(): void {
  const hash = window.location.hash;
  if (!hash) return;

  const h = hash.replace(/^#\/?/, "");
  if (h === "history") {
    history.replaceState(null, "", "/history");
  } else {
    const match = h.match(/^summary\/(.+)$/);
    if (match) {
      history.replaceState(null, "", `/s/${match[1]}`);
    } else if (h === "" || h === "/") {
      history.replaceState(null, "", "/");
    }
  }
}

// Run hash migration once on load
migrateHashRoute();

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parsePath(window.location.pathname),
  );

  useEffect(() => {
    const handler = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener("popstate", handler);
    window.addEventListener(NAV_EVENT, handler);
    return () => {
      window.removeEventListener("popstate", handler);
      window.removeEventListener(NAV_EVENT, handler);
    };
  }, []);

  return route;
}

export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAV_EVENT));
}

/**
 * Internal link component that uses pushState navigation.
 * Prevents full-page reloads for same-origin paths.
 */
export function Link({
  href,
  children,
  ...props
}: {
  href: string;
  children: ComponentChildren;
  [key: string]: any;
}) {
  const handleClick = (e: MouseEvent) => {
    // Allow modified clicks (new tab, etc.) to pass through
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <a href={href} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `pnpm -C apps/web build 2>&1 | head -30`
Expected: No TypeScript errors in router.ts (build may fail elsewhere due to downstream changes — that's expected)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/router.ts
git commit -m "feat(web): replace hash router with path-based router and Link component"
```

---

### Task 6: Update `app.tsx` to use path-based navigation

**Files:**

- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Update imports and navigation links**

In `apps/web/src/app.tsx`:

1. Import `Link` from router:

```ts
import { useRoute, Link } from "./lib/router.js";
```

2. Replace the brand title link (line 60):

```tsx
<Link href="/" style={{ color: "inherit", textDecoration: "none" }}>
  Summarize_p2
</Link>
```

3. Replace nav tab hrefs (lines 76-81):

```tsx
<NavTab href="/" active={route.view === "summarize"}>
  Summarize_p2
</NavTab>
<NavTab href="/history" active={route.view === "history"}>
  History
</NavTab>
```

4. Update `NavTab` to use `Link` internally — replace the `<a>` with `Link`:

```tsx
function NavTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: preact.ComponentChildren;
}) {
  return (
    <Link
      href={href}
      style={{
        borderRadius: "8px",
        padding: "6px 16px",
        fontSize: "13px",
        fontWeight: active ? "700" : "500",
        fontFamily: "var(--font-body)",
        border: `1px solid ${active ? "var(--border)" : "transparent"}`,
        background: active ? "var(--surface)" : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        cursor: "pointer",
        transition: "color 180ms ease, background 180ms ease, border-color 180ms ease",
        letterSpacing: "0.01em",
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}
```

5. Update the skip link:

```tsx
<a href="#main" class="skip-link">
```

(This one stays as a plain `<a>` since it's an in-page anchor, not a route)

6. Remove the always-mounted `SummarizeView` pattern. Replace lines 84-91 with:

```tsx
<main id="main">
  {route.view === "summarize" && <SummarizeView />}
  {route.view === "history" && <HistoryView />}
  {route.view === "summary" && <SummaryDetail id={route.id} />}
</main>
```

Note: `SummaryDetail` will later be replaced by `ProcessView` in Task 8. For now keep it to avoid breaking things.

- [ ] **Step 2: Verify the app builds**

Run: `pnpm -C apps/web build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app.tsx
git commit -m "feat(web): update app.tsx to use path-based Link navigation"
```

---

### Task 7: Update `api.ts` with `onInit` callback and `connectToProcess`

**Files:**

- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add `init` event type and `onInit` callback to `summarizeSSE`**

In `apps/web/src/lib/api.ts`:

1. Add the `SseInitEvent` type after line 114:

```ts
export type SseInitEvent = { event: "init"; data: { summaryId: string } };
```

2. Add it to the `SseEvent` union:

```ts
export type SseEvent =
  | SseInitEvent
  | SseStatusEvent
  | SseChunkEvent
  | SseMetaEvent
  | SseDoneEvent
  | SseErrorEvent
  | SseMetricsEvent
  | SseSlidesEvent;
```

3. Add `onInit` to `summarizeSSE` callbacks parameter (line 166-173):

```ts
callbacks: {
  onInit?: (summaryId: string) => void;
  onStatus?: (text: string) => void;
  onChunk?: (text: string) => void;
  onMeta?: (data: SseMetaEvent["data"]) => void;
  onDone?: (summaryId: string) => void;
  onError?: (message: string, code: string) => void;
  onMetrics?: (data: Record<string, unknown>) => void;
},
```

4. Add the `init` case to the switch (after line 222):

```ts
case "init":
  callbacks.onInit?.(data.summaryId);
  break;
```

5. Add a new `connectToProcess` function for reconnection:

```ts
/**
 * Connect to an in-progress or completed process via the reconnection endpoint.
 * Returns null if the session is not found (404).
 */
export function connectToProcess(
  summaryId: string,
  callbacks: {
    onInit?: (summaryId: string) => void;
    onStatus?: (text: string) => void;
    onChunk?: (text: string) => void;
    onMeta?: (data: SseMetaEvent["data"]) => void;
    onDone?: (summaryId: string) => void;
    onError?: (message: string, code: string) => void;
    onMetrics?: (data: Record<string, unknown>) => void;
  },
): AbortController {
  const controller = new AbortController();

  fetch(`/v1/summarize/${encodeURIComponent(summaryId)}/events`, {
    headers: { ...authHeaders(), Accept: "text/event-stream" },
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        callbacks.onError?.(
          res.status === 404 ? "not_found" : `Request failed (${res.status})`,
          res.status === 404 ? "NOT_FOUND" : "HTTP_ERROR",
        );
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError?.("No response body", "NO_BODY");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (currentEvent) {
                case "init":
                  callbacks.onInit?.(data.summaryId);
                  break;
                case "status":
                  callbacks.onStatus?.(data.text);
                  break;
                case "chunk":
                  callbacks.onChunk?.(data.text);
                  break;
                case "meta":
                  callbacks.onMeta?.(data);
                  break;
                case "done":
                  callbacks.onDone?.(data.summaryId);
                  break;
                case "error":
                  callbacks.onError?.(data.message, data.code);
                  break;
                case "metrics":
                  callbacks.onMetrics?.(data);
                  break;
              }
            } catch {
              // skip malformed data
            }
            currentEvent = "";
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        callbacks.onError?.(err.message ?? "Network error", "NETWORK_ERROR");
      }
    });

  return controller;
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm -C apps/web build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): add onInit callback to summarizeSSE and connectToProcess function"
```

---

### Task 8: Wire `onInit` in SummarizeView, update HistoryView and SummaryDetail links

**Files:**

- Modify: `apps/web/src/components/summarize-view.tsx`
- Modify: `apps/web/src/components/history-view.tsx`
- Modify: `apps/web/src/components/summary-detail.tsx`

- [ ] **Step 1: Add `onInit` handler to SummarizeView**

In `apps/web/src/components/summarize-view.tsx`, update the `summarizeSSE` call in `handleSubmit` (lines 65-80):

```ts
controllerRef.current = summarizeSSE(body, {
  onInit: (id) => {
    setSummaryId(id);
    navigate(`/s/${id}`);
  },
  onStatus: (text) => setStatusText(text),
  onChunk: (text) => setChunks((prev) => prev + text),
  onMeta: () => {},
  onDone: (id) => {
    setSummaryId(id);
    setPhase("done");
    stopTimer();
  },
  onError: (message) => {
    setErrorMsg(message);
    setPhase("error");
    stopTimer();
  },
  onMetrics: () => {},
});
```

Also remove the "View details" button (lines 262-284) since the URL is already `/s/{id}` by the time `done` fires. Remove the entire `{phase === "done" && summaryId && (` block for the "View details" button, keeping only the "Copy" button.

- [ ] **Step 2: Update HistoryView links to use path-based navigation**

In `apps/web/src/components/history-view.tsx`, change `navigate(\`/summary/${entry.id}\`)` to `navigate(\`/s/${entry.id}\`)`in both the`onClick`and`onKeyDown` handlers (lines 74, 78).

- [ ] **Step 3: Update SummaryDetail navigation**

In `apps/web/src/components/summary-detail.tsx`:

1. The `BackButton` component (line 160) calls `navigate("/history")` — this already works with path-based routing.
2. The `handleDelete` function (line 58) calls `navigate("/history")` — also fine.
3. No changes needed here since `navigate()` is now path-based.

- [ ] **Step 4: Verify build**

Run: `pnpm -C apps/web build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/summarize-view.tsx apps/web/src/components/history-view.tsx
git commit -m "feat(web): wire onInit to update URL, update history links to /s/ paths"
```

---

## Chunk 3: ProcessView & NotFoundView

### Task 9: Create NotFoundView component

**Files:**

- Create: `apps/web/src/components/not-found-view.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/not-found-view.tsx`:

```tsx
import { Link } from "../lib/router.js";

export function NotFoundView() {
  return (
    <div style={{ textAlign: "center", padding: "48px 0" }}>
      <h2 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "8px" }}>
        Summary not found
      </h2>
      <p
        style={{ fontSize: "14px", color: "var(--muted)", marginBottom: "24px", lineHeight: "1.5" }}
      >
        This summary may have expired or the link may be incorrect.
      </p>
      <Link
        href="/"
        style={{
          padding: "8px 16px",
          fontSize: "14px",
          fontWeight: "600",
          fontFamily: "var(--font-body)",
          color: "var(--accent-text)",
          background: "var(--accent)",
          border: "none",
          borderRadius: "8px",
          textDecoration: "none",
          display: "inline-block",
        }}
      >
        Create a new summary
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm -C apps/web build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/not-found-view.tsx
git commit -m "feat(web): add NotFoundView component for missing summaries"
```

---

### Task 10: Create ProcessView — unified streaming/completed view

**Files:**

- Create: `apps/web/src/components/process-view.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Create ProcessView component**

Create `apps/web/src/components/process-view.tsx`:

```tsx
import { useEffect, useRef, useState } from "preact/hooks";
import { connectToProcess, fetchHistoryDetail, type HistoryDetailEntry } from "../lib/api.js";
import { SummaryDetail } from "./summary-detail.js";
import { NotFoundView } from "./not-found-view.js";
import { StreamingMarkdown } from "./streaming-markdown.js";
import { ChatPanel } from "./chat-panel.js";
import "../styles/markdown.css";

type Phase = "loading" | "streaming" | "done" | "not-found";

export function ProcessView({ id }: { id: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [chunks, setChunks] = useState("");
  const [statusText, setStatusText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [historyEntry, setHistoryEntry] = useState<HistoryDetailEntry | null>(null);
  const [copied, setCopied] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    // Reset state on ID change
    setPhase("loading");
    setChunks("");
    setStatusText("");
    setElapsed(0);
    setHistoryEntry(null);
    controllerRef.current?.abort();
    stopTimer();

    // Start elapsed timer
    const start = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    // Try connecting to active SSE session
    controllerRef.current = connectToProcess(id, {
      onStatus: (text) => {
        setPhase("streaming");
        setStatusText(text);
      },
      onChunk: (text) => {
        setPhase("streaming");
        setChunks((prev) => prev + text);
      },
      onMeta: () => {},
      onDone: () => {
        setPhase("done");
        stopTimer();
        // Load the full history entry for metadata, media, etc.
        fetchHistoryDetail(id)
          .then(setHistoryEntry)
          .catch(() => {}); // summary just completed, detail may take a moment
      },
      onError: (message, code) => {
        if (code === "NOT_FOUND") {
          // Session expired or never existed — try loading from history
          stopTimer();
          fetchHistoryDetail(id)
            .then((entry) => {
              setHistoryEntry(entry);
              setPhase("done");
            })
            .catch(() => {
              setPhase("not-found");
            });
        }
      },
      onMetrics: () => {},
    });

    return () => {
      controllerRef.current?.abort();
      stopTimer();
    };
  }, [id]);

  // Loading skeleton
  if (phase === "loading") {
    return (
      <div style={{ padding: "24px 0", color: "var(--muted)", fontSize: "14px" }}>
        Connecting...
      </div>
    );
  }

  // Not found
  if (phase === "not-found") {
    return <NotFoundView />;
  }

  // Completed — delegate to SummaryDetail for full metadata/media/chat experience
  if (phase === "done" && historyEntry) {
    return <SummaryDetail id={id} />;
  }

  // Streaming or just completed (waiting for history entry to load)
  return (
    <div>
      {/* Progress bar */}
      {phase === "streaming" && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}
        >
          <div
            style={{
              width: "100%",
              height: "2px",
              background: "var(--border)",
              borderRadius: "1px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "30%",
                height: "100%",
                background: "var(--accent)",
                borderRadius: "1px",
                animation: "loadingSlide 1.6s var(--ease-out-quart) infinite",
              }}
            />
          </div>
          <span style={{ fontSize: "13px", color: "var(--muted)", letterSpacing: "0.01em" }}>
            {statusText || "Summarizing\u2026"} ({elapsed}s)
          </span>
        </div>
      )}

      {/* Streamed content */}
      {chunks && (
        <div style={{ animation: "fadeInUp 500ms var(--ease-out-expo)" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(chunks);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 10px",
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                fontWeight: "500",
                color: copied ? "var(--accent)" : "var(--muted)",
                background: "transparent",
                border: `1px solid ${copied ? "color-mix(in srgb, var(--accent) 30%, transparent)" : "var(--border)"}`,
                borderRadius: "6px",
                cursor: "pointer",
                transition: "color 150ms ease, border-color 150ms ease",
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <StreamingMarkdown text={chunks} streaming={phase === "streaming"} />
        </div>
      )}

      {/* Chat — available once done but before history entry loads */}
      {phase === "done" && <ChatPanel summaryId={id} />}
    </div>
  );
}
```

- [ ] **Step 2: Update `app.tsx` route table to use ProcessView**

In `apps/web/src/app.tsx`:

1. Add import:

```ts
import { ProcessView } from "./components/process-view.js";
```

2. Replace the route rendering in `<main>`:

```tsx
<main id="main">
  {route.view === "summarize" && <SummarizeView />}
  {route.view === "history" && <HistoryView />}
  {route.view === "summary" && <ProcessView id={route.id} />}
</main>
```

(This replaces `SummaryDetail` with `ProcessView` in the route table.)

**Note:** This also changes `SummarizeView` from always-mounted (hidden via `display: none`) to conditionally rendered. Form state (URL input, text, length) will be lost when navigating away. This is intentional — streaming state is now recoverable via SSE reconnection, and form state preservation is explicitly out of scope (see spec).

- [ ] **Step 3: Verify build**

Run: `pnpm -C apps/web build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/process-view.tsx apps/web/src/components/not-found-view.tsx apps/web/src/app.tsx
git commit -m "feat(web): add ProcessView for unified streaming/completed summary display"
```

---

### Task 11: Verify SseInitEvent in core package

The `init` event was already added to `packages/core/src/shared/sse-events.ts` in Task 2, Step 3 (Chunk 1). This task just verifies the core package builds cleanly.

**Files:**

- Already modified in Task 2: `packages/core/src/shared/sse-events.ts`

- [ ] **Step 1: Verify core package builds**

Run: `pnpm -C packages/core build`
Expected: PASS

- [ ] **Step 2: Run full build to verify downstream consumers**

Run: `pnpm build`
Expected: PASS — `sse-session.ts` imports `SseEvent` from core and should accept the new `init` variant

---

### Task 12: Update Vite config for SPA history fallback

**Files:**

- Modify: `apps/web/vite.config.ts`

- [ ] **Step 1: Verify and configure history API fallback**

Vite's default SPA mode (`appType: 'spa'`) should handle this. But the proxy config must also handle `/s/*` paths correctly. Update `apps/web/vite.config.ts`:

```ts
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:3000",
    },
  },
});
```

Vite's default `appType: 'spa'` already serves `index.html` for unmatched routes in dev mode. No change needed — but verify by running:

Run: `pnpm -C apps/web dev &` then `curl http://localhost:5173/s/test-id -s | head -5`
Expected: Should return HTML content (the SPA index.html)

If it returns 404, add explicitly:

```ts
appType: "spa",
```

- [ ] **Step 2: Commit (only if changes were needed)**

```bash
git add apps/web/vite.config.ts
git commit -m "chore(web): verify Vite SPA history fallback for path-based routing"
```

---

### Task 13: Full build and test validation

- [ ] **Step 1: Run full build**

Run: `pnpm build`
Expected: PASS — all packages build successfully

- [ ] **Step 2: Run full test suite**

Run: `pnpm vitest run`
Expected: PASS — all tests pass

- [ ] **Step 3: Manual smoke test**

1. Start the API server: `node dist/esm/server/main.js`
2. Open `http://localhost:3000` in browser
3. Submit a URL for summarization
4. Verify:
   - URL changes from `/` to `/s/{uuid}` within ~1 second of submitting
   - Streaming content appears
   - Refresh the page → content reappears (buffered + live)
   - After completion, page shows full summary with metadata
   - Click "History" → see the entry → click it → URL is `/s/{id}`
   - Open `/s/nonexistent-id` → see 404 page
   - Open old hash URL `/#/summary/{id}` → redirects to `/s/{id}`
   - Browser back/forward works correctly

- [ ] **Step 4: Final commit (only if there are unstaged fixes from smoke testing)**

```bash
git add apps/web/ src/server/ packages/core/ tests/
git commit -m "fix: address smoke test issues for persistent process URLs"
```
