# Share Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public, unauthenticated share links for history entries so users can share summaries via URL.

**Architecture:** A `shared_token` column on the existing `history` table maps random 12-char tokens to entries. New unauthenticated `/v1/shared/:token` endpoints serve a reduced payload. The frontend gets a new `/share/:token` route rendering a standalone `SharedSummaryView` component, plus a share button in the existing `SummaryDetail`.

**Tech Stack:** Hono (server), SQLite (storage), Preact (frontend), `crypto.randomUUID()` for token generation (truncated to 12 URL-safe chars), vitest (tests)

---

### Task 1: DB Migration — Add `shared_token` column to history

**Files:**

- Modify: `src/history.ts`
- Test: `tests/server.share.test.ts` (create new)

- [ ] **Step 1: Write failing test for share token storage**

Create `tests/server.share.test.ts`:

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHistoryStore, type HistoryStore } from "../src/history.js";

describe("History store share token", () => {
  let tmpDir: string;
  let store: HistoryStore;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "share-test-"));
    store = await createHistoryStore({ path: join(tmpDir, "history.sqlite") });
    store.insert({
      id: "entry-1",
      createdAt: "2026-03-26T10:00:00Z",
      account: "test-user",
      sourceUrl: "https://example.com/article",
      sourceType: "article",
      inputLength: "medium",
      model: "test-model",
      title: "Test Article",
      summary: "# Summary\n\nThis is a test summary.",
      transcript: "Full transcript text here.",
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: JSON.stringify({ wordCount: 500, mediaDurationSeconds: 120 }),
    });
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("setShareToken stores a token and getByShareToken retrieves it", () => {
    const token = "abc123def456";
    const result = store.setShareToken("entry-1", "test-user", token);
    expect(result).toBe(true);

    const entry = store.getByShareToken(token);
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("entry-1");
    expect(entry!.title).toBe("Test Article");
  });

  it("getByShareToken returns null for unknown token", () => {
    expect(store.getByShareToken("nonexistent")).toBeNull();
  });

  it("clearShareToken removes the token", () => {
    store.setShareToken("entry-1", "test-user", "token123token");
    const cleared = store.clearShareToken("entry-1", "test-user");
    expect(cleared).toBe(true);
    expect(store.getByShareToken("token123token")).toBeNull();
  });

  it("clearShareToken returns false for entry without token", () => {
    expect(store.clearShareToken("entry-1", "test-user")).toBe(false);
  });

  it("getShareToken returns token for shared entry", () => {
    store.setShareToken("entry-1", "test-user", "mytoken12345");
    expect(store.getShareToken("entry-1", "test-user")).toBe("mytoken12345");
  });

  it("getShareToken returns null for non-shared entry", () => {
    expect(store.getShareToken("entry-1", "test-user")).toBeNull();
  });

  it("setShareToken is idempotent (second call returns existing token)", () => {
    store.setShareToken("entry-1", "test-user", "first_token_1");
    const result = store.setShareToken("entry-1", "test-user", "second_token2");
    // Should not overwrite — return false to signal existing token
    expect(result).toBe(false);
    expect(store.getShareToken("entry-1", "test-user")).toBe("first_token_1");
  });

  it("setShareToken fails for wrong account", () => {
    const result = store.setShareToken("entry-1", "wrong-account", "token123abc");
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: FAIL — `setShareToken` and `getByShareToken` not found on HistoryStore

- [ ] **Step 3: Implement DB migration and store methods**

In `src/history.ts`, add to `HistoryStore` type (after `deleteById`):

```typescript
setShareToken: (id: string, account: string, token: string) => boolean;
clearShareToken: (id: string, account: string) => boolean;
getShareToken: (id: string, account: string) => string | null;
getByShareToken: (token: string) => HistoryEntry | null;
```

After the existing audio column migration block (after line 148), add:

```typescript
// Migrate: add shared_token column if missing
const colInfo2 = db.prepare("PRAGMA table_info(history)").all() as Array<{ name: string }>;
if (!colInfo2.some((col) => col.name === "shared_token")) {
  db.exec("ALTER TABLE history ADD COLUMN shared_token TEXT");
}
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_history_shared_token ON history(shared_token) WHERE shared_token IS NOT NULL",
);
```

Add prepared statements after existing ones (after `stmtDelete`):

```typescript
const stmtSetShareToken = db.prepare(
  "UPDATE history SET shared_token = ? WHERE id = ? AND account = ? AND shared_token IS NULL",
);
const stmtClearShareToken = db.prepare(
  "UPDATE history SET shared_token = NULL WHERE id = ? AND account = ? AND shared_token IS NOT NULL",
);
const stmtGetShareToken = db.prepare(
  "SELECT shared_token FROM history WHERE id = ? AND account = ?",
);
const stmtGetByShareToken = db.prepare("SELECT * FROM history WHERE shared_token = ?");
```

Add method implementations before the `return` statement:

```typescript
const setShareToken = (id: string, account: string, token: string): boolean => {
  const result = stmtSetShareToken.run(token, id, account) as { changes?: number };
  return typeof result?.changes === "number" ? result.changes > 0 : false;
};

const clearShareToken = (id: string, account: string): boolean => {
  const result = stmtClearShareToken.run(id, account) as { changes?: number };
  return typeof result?.changes === "number" ? result.changes > 0 : false;
};

const getShareToken = (id: string, account: string): string | null => {
  const row = stmtGetShareToken.get(id, account) as { shared_token: string | null } | undefined;
  return row?.shared_token ?? null;
};

const getByShareToken = (token: string): HistoryEntry | null => {
  const row = stmtGetByShareToken.get(token) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRow(row);
};
```

Update the return statement to include the new methods:

```typescript
return {
  insert,
  getById,
  updateSummary,
  list,
  deleteById,
  setShareToken,
  clearShareToken,
  getShareToken,
  getByShareToken,
  close,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm vitest run`
Expected: All existing tests still pass (migration is additive)

- [ ] **Step 6: Commit**

```bash
git add src/history.ts tests/server.share.test.ts
git commit -m "feat: add shared_token column and store methods for share links"
```

---

### Task 2: Share API endpoints — create, revoke, get public

**Files:**

- Create: `src/server/routes/shared.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/routes/history.ts`
- Test: `tests/server.share.test.ts` (extend)

- [ ] **Step 1: Write failing tests for share API endpoints**

Append to `tests/server.share.test.ts`:

```typescript
import { Hono } from "hono";
import { createSharedRoute } from "../src/server/routes/shared.js";
import { createHistoryRoute } from "../src/server/routes/history.js";

describe("Share API routes", () => {
  let tmpDir: string;
  let store: HistoryStore;
  let app: Hono;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "share-api-test-"));
    store = await createHistoryStore({ path: join(tmpDir, "history.sqlite") });

    // Insert test entry with transcript (needed for resummarize)
    store.insert({
      id: "entry-1",
      createdAt: "2026-03-26T10:00:00Z",
      account: "test-user",
      sourceUrl: "https://example.com/article",
      sourceType: "article",
      inputLength: "medium",
      model: "test-model",
      title: "Test Article",
      summary: "# Summary\n\nThis is a test summary.",
      transcript: "Full transcript text here.",
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: JSON.stringify({ wordCount: 500, mediaDurationSeconds: 120 }),
    });

    const historyRoute = createHistoryRoute({
      historyStore: store,
      historyMediaPath: join(tmpDir, "media"),
    });
    const sharedRoute = createSharedRoute({ historyStore: store });

    app = new Hono();
    // Auth middleware for protected routes
    app.use("/v1/history/*", async (c, next) => {
      c.set("account", "test-user");
      await next();
    });
    app.use("/v1/history", async (c, next) => {
      c.set("account", "test-user");
      await next();
    });
    app.route("/v1", historyRoute);
    // Shared routes — no auth middleware
    app.route("/v1", sharedRoute);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("POST /v1/history/:id/share creates a share token", async () => {
    const res = await app.request("/v1/history/entry-1/share", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTypeOf("string");
    expect(body.token.length).toBe(12);
    expect(body.url).toContain(`/share/${body.token}`);
  });

  it("POST /v1/history/:id/share is idempotent", async () => {
    const res1 = await app.request("/v1/history/entry-1/share", { method: "POST" });
    const body1 = await res1.json();
    const res2 = await app.request("/v1/history/entry-1/share", { method: "POST" });
    const body2 = await res2.json();
    expect(body1.token).toBe(body2.token);
  });

  it("POST /v1/history/:id/share returns 404 for unknown entry", async () => {
    const res = await app.request("/v1/history/nonexistent/share", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("GET /v1/shared/:token returns public payload", async () => {
    const createRes = await app.request("/v1/history/entry-1/share", { method: "POST" });
    const { token } = await createRes.json();

    const res = await app.request(`/v1/shared/${token}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Test Article");
    expect(body.summary).toContain("test summary");
    expect(body.sourceUrl).toBe("https://example.com/article");
    expect(body.sourceType).toBe("article");
    expect(body.model).toBe("test-model");
    expect(body.createdAt).toBe("2026-03-26T10:00:00Z");
    expect(body.inputLength).toBe("medium");
    // Must NOT leak internal fields
    expect(body.id).toBeUndefined();
    expect(body.account).toBeUndefined();
    expect(body.transcript).toBeUndefined();
    expect(body.mediaPath).toBeUndefined();
  });

  it("GET /v1/shared/:token returns 404 for unknown token", async () => {
    const res = await app.request("/v1/shared/nonexistent1");
    expect(res.status).toBe(404);
  });

  it("DELETE /v1/history/:id/share revokes the share", async () => {
    const createRes = await app.request("/v1/history/entry-1/share", { method: "POST" });
    const { token } = await createRes.json();

    const deleteRes = await app.request("/v1/history/entry-1/share", { method: "DELETE" });
    expect(deleteRes.status).toBe(204);

    const getRes = await app.request(`/v1/shared/${token}`);
    expect(getRes.status).toBe(404);
  });

  it("DELETE /v1/history/:id/share returns 404 when not shared", async () => {
    const res = await app.request("/v1/history/entry-1/share", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("GET /v1/history/:id includes sharedToken in detail response", async () => {
    // Before sharing
    const res1 = await app.request("/v1/history/entry-1");
    const body1 = await res1.json();
    expect(body1.sharedToken).toBeNull();

    // After sharing
    await app.request("/v1/history/entry-1/share", { method: "POST" });
    const res2 = await app.request("/v1/history/entry-1");
    const body2 = await res2.json();
    expect(body2.sharedToken).toBeTypeOf("string");
    expect(body2.sharedToken.length).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: FAIL — `createSharedRoute` module not found

- [ ] **Step 3: Create shared routes**

Create `src/server/routes/shared.ts`:

```typescript
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { HistoryStore } from "../../history.js";

export type SharedRouteDeps = {
  historyStore: HistoryStore;
};

type Variables = { account: string };

/** Generate a 12-character URL-safe random token. */
function generateShareToken(): string {
  // 9 random bytes → 12 base64url characters
  return randomBytes(9).toString("base64url").slice(0, 12);
}

/**
 * Routes for public (unauthenticated) shared content access.
 * Also includes protected share/unshare management endpoints
 * that rely on the `account` variable being set by auth middleware.
 */
export function createSharedRoute(deps: SharedRouteDeps): Hono<{ Variables: Variables }> {
  const route = new Hono<{ Variables: Variables }>();

  // POST /history/:id/share — create share token (auth required, set by middleware)
  route.post("/history/:id/share", (c) => {
    const account = c.get("account") as string;
    const entryId = c.req.param("id");

    // Check entry exists and belongs to account
    const entry = deps.historyStore.getById(entryId, account);
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "History entry not found" } }, 404);
    }

    // Check if already shared — return existing token
    const existing = deps.historyStore.getShareToken(entryId, account);
    if (existing) {
      const host = c.req.header("host") ?? "localhost";
      const proto = c.req.header("x-forwarded-proto") ?? "http";
      return c.json({ token: existing, url: `${proto}://${host}/share/${existing}` });
    }

    // Generate and store new token
    const token = generateShareToken();
    const stored = deps.historyStore.setShareToken(entryId, account, token);
    if (!stored) {
      return c.json(
        { error: { code: "STORE_FAILED", message: "Failed to create share link" } },
        500,
      );
    }

    const host = c.req.header("host") ?? "localhost";
    const proto = c.req.header("x-forwarded-proto") ?? "http";
    return c.json({ token, url: `${proto}://${host}/share/${token}` });
  });

  // DELETE /history/:id/share — revoke share token (auth required)
  route.delete("/history/:id/share", (c) => {
    const account = c.get("account") as string;
    const entryId = c.req.param("id");

    const cleared = deps.historyStore.clearShareToken(entryId, account);
    if (!cleared) {
      return c.json({ error: { code: "NOT_FOUND", message: "No active share link found" } }, 404);
    }

    return new Response(null, { status: 204 });
  });

  // GET /shared/:token — public payload (no auth)
  route.get("/shared/:token", (c) => {
    const token = c.req.param("token");
    const entry = deps.historyStore.getByShareToken(token);
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    }

    // Parse metadata to extract public-safe fields
    let parsedMeta: Record<string, unknown> | null = null;
    if (entry.metadata) {
      try {
        parsedMeta = JSON.parse(entry.metadata);
      } catch {
        // ignore
      }
    }

    return c.json({
      title: entry.title,
      summary: entry.summary,
      sourceUrl: entry.sourceUrl,
      sourceType: entry.sourceType,
      model: entry.model,
      createdAt: entry.createdAt,
      inputLength: entry.inputLength,
      metadata: {
        mediaDurationSeconds: (parsedMeta?.mediaDurationSeconds as number) ?? null,
        wordCount: (parsedMeta?.wordCount as number) ?? null,
      },
    });
  });

  return route;
}
```

- [ ] **Step 4: Modify history detail response to include `sharedToken`**

In `src/server/routes/history.ts`, modify the `GET /history/:id` handler. Change the return statement (around line 44-52) to include `sharedToken`:

Replace:

```typescript
return c.json({
  ...entry,
  hasTranscript,
  hasMedia,
  hasAudio,
  mediaUrl: hasMedia ? `/v1/history/${entry.id}/media` : null,
  audioUrl: hasAudio ? `/v1/history/${entry.id}/audio` : null,
  transcriptUrl: hasTranscript ? `/v1/history/${entry.id}/transcript` : null,
});
```

With:

```typescript
const sharedToken = deps.historyStore.getShareToken(entry.id, account);
return c.json({
  ...entry,
  hasTranscript,
  hasMedia,
  hasAudio,
  sharedToken,
  mediaUrl: hasMedia ? `/v1/history/${entry.id}/media` : null,
  audioUrl: hasAudio ? `/v1/history/${entry.id}/audio` : null,
  transcriptUrl: hasTranscript ? `/v1/history/${entry.id}/transcript` : null,
});
```

- [ ] **Step 5: Register shared routes in server**

In `src/server/index.ts`, add import at top:

```typescript
import { createSharedRoute } from "./routes/shared.js";
```

Inside the `if (deps.historyStore)` block (after the resummarize route registration, around line 151), add:

```typescript
// Share management (protected: POST/DELETE under /v1/history/:id/share)
// Already covered by /v1/history/* auth middleware above.
// Public shared content (no auth)
const sharedRoute = createSharedRoute({ historyStore: deps.historyStore });
app.route("/v1", sharedRoute);
```

Note: The `POST /history/:id/share` and `DELETE /history/:id/share` paths are already covered by the existing `app.use("/v1/history/*", auth)` middleware. The `GET /shared/:token` path does NOT match `/v1/history/*` so it won't require auth.

- [ ] **Step 6: Run tests to verify everything passes**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: All tests PASS (both store tests and API route tests)

- [ ] **Step 7: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/server/routes/shared.ts src/server/routes/history.ts src/server/index.ts tests/server.share.test.ts
git commit -m "feat: add share/unshare API endpoints and public shared content route"
```

---

### Task 3: Public resummarize endpoint with rate limiting

**Files:**

- Modify: `src/server/routes/shared.ts`
- Modify: `src/server/index.ts`
- Test: `tests/server.share.test.ts` (extend)

- [ ] **Step 1: Write failing tests for public resummarize**

Append to the "Share API routes" describe block in `tests/server.share.test.ts`:

```typescript
it("POST /v1/shared/:token/resummarize returns 404 for unknown token", async () => {
  const res = await app.request("/v1/shared/nonexistent1/resummarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ length: "short" }),
  });
  expect(res.status).toBe(404);
});

it("POST /v1/shared/:token/resummarize returns 422 when no transcript", async () => {
  // Insert entry without transcript
  store.insert({
    id: "no-transcript",
    createdAt: "2026-03-26T10:00:00Z",
    account: "test-user",
    sourceUrl: null,
    sourceType: "article",
    inputLength: "medium",
    model: "test-model",
    title: "No Transcript",
    summary: "Just a summary.",
    transcript: null,
    mediaPath: null,
    mediaSize: null,
    mediaType: null,
    audioPath: null,
    audioSize: null,
    audioType: null,
    metadata: null,
  });
  store.setShareToken("no-transcript", "test-user", "notranscript1");

  const res = await app.request("/v1/shared/notranscript1/resummarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ length: "short" }),
  });
  expect(res.status).toBe(422);
});

it("POST /v1/shared/:token/resummarize returns 400 without length", async () => {
  await app.request("/v1/history/entry-1/share", { method: "POST" });
  const token = store.getShareToken("entry-1", "test-user")!;

  const res = await app.request(`/v1/shared/${token}/resummarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: FAIL — route not matched (404 for all, but we expect specific 404/422/400)

- [ ] **Step 3: Implement public resummarize endpoint**

In `src/server/routes/shared.ts`, update the deps type and add the endpoint.

Update the deps type:

```typescript
export type SharedRouteDeps = {
  historyStore: HistoryStore;
  /** The main Hono app — used to internally dispatch a /v1/summarize request for public resummarize. */
  app?: Hono;
  /** Auth token for an internal account to use when dispatching resummarize requests. */
  internalAuthHeader?: string;
};
```

Add import at top:

```typescript
import type { ApiLength } from "../types.js";
import { mapApiLength } from "../utils/length-map.js";
```

Add rate limiter before the `createSharedRoute` function:

```typescript
/** Simple in-memory rate limiter: max requests per token per window. */
const rateLimits = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(token: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(token);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(token, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}
```

Add the resummarize endpoint inside `createSharedRoute`, after the `GET /shared/:token` handler:

```typescript
// POST /shared/:token/resummarize — public re-summarize (no auth, rate-limited, transient)
route.post("/shared/:token/resummarize", async (c) => {
  const token = c.req.param("token");
  const entry = deps.historyStore.getByShareToken(token);
  if (!entry) {
    return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  }

  if (!entry.transcript || entry.transcript.length === 0) {
    return c.json(
      {
        error: { code: "NO_TRANSCRIPT", message: "No source text available for re-summarization" },
      },
      422,
    );
  }

  const body = await c.req.json<{ length?: ApiLength }>().catch((): { length?: ApiLength } => ({}));
  if (!body.length) {
    return c.json(
      { error: { code: "MISSING_LENGTH", message: "length parameter is required" } },
      400,
    );
  }

  try {
    mapApiLength(body.length);
  } catch {
    return c.json(
      { error: { code: "INVALID_LENGTH", message: `Invalid length: ${body.length}` } },
      400,
    );
  }

  if (!checkRateLimit(token)) {
    return c.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } },
      429,
    );
  }

  if (!deps.app || !deps.internalAuthHeader) {
    return c.json(
      { error: { code: "NOT_CONFIGURED", message: "Re-summarization not available" } },
      503,
    );
  }

  // Dispatch internal summarize request — result is transient (NOT persisted)
  const internalReq = new Request("http://internal/v1/summarize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: deps.internalAuthHeader,
    },
    body: JSON.stringify({ text: entry.transcript, length: body.length }),
  });

  const internalRes = await deps.app.fetch(internalReq);
  if (!internalRes.ok || !internalRes.body) {
    return c.json({ error: { code: "SUMMARIZE_FAILED", message: "Re-summarization failed" } }, 502);
  }

  // Stream through without intercepting — transient result, not persisted
  return new Response(internalRes.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
```

- [ ] **Step 4: Update server index to pass app and auth header to shared route**

In `src/server/index.ts`, update the shared route creation (inside the `if (deps.historyStore)` block):

```typescript
// Share management + public shared content
// The first account's token is used for internal resummarize dispatch.
const sharedRoute = createSharedRoute({
  historyStore: deps.historyStore,
  app,
  internalAuthHeader: deps.accounts.length > 0 ? `Bearer ${deps.accounts[0].token}` : undefined,
});
app.route("/v1", sharedRoute);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/shared.ts src/server/index.ts tests/server.share.test.ts
git commit -m "feat: add public resummarize endpoint with rate limiting"
```

---

### Task 4: Frontend — Router and API client additions

**Files:**

- Modify: `apps/web/src/lib/router.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Add shared route to router**

In `apps/web/src/lib/router.tsx`, update the Route type:

```typescript
export type Route =
  | { view: "summarize" }
  | { view: "history" }
  | { view: "summary"; id: string }
  | { view: "shared"; token: string };
```

Update `parsePath` to handle `/share/:token`:

```typescript
function parsePath(pathname: string): Route {
  if (pathname === "/history") return { view: "history" };
  const summaryMatch = pathname.match(/^\/s\/([^/]+)$/);
  if (summaryMatch) return { view: "summary", id: summaryMatch[1] };
  const shareMatch = pathname.match(/^\/share\/([^/]+)$/);
  if (shareMatch) return { view: "shared", token: shareMatch[1] };
  return { view: "summarize" };
}
```

- [ ] **Step 2: Add API client functions**

In `apps/web/src/lib/api.ts`, add the shared content type and API functions.

Add type after `HistoryDetailEntry`:

```typescript
export type SharedSummaryResponse = {
  title: string | null;
  summary: string;
  sourceUrl: string | null;
  sourceType: string;
  model: string;
  createdAt: string;
  inputLength: string;
  metadata: {
    mediaDurationSeconds: number | null;
    wordCount: number | null;
  };
};
```

Add `sharedToken` to `HistoryDetailEntry`:

```typescript
export type HistoryDetailEntry = HistoryEntry & {
  hasTranscript: boolean;
  hasMedia: boolean;
  hasAudio: boolean;
  sharedToken: string | null;
  mediaUrl: string | null;
  audioUrl: string | null;
  transcriptUrl: string | null;
};
```

Add API functions at the end of the file (before the closing):

```typescript
// ── Share API functions ──────────────────────────────────

export async function fetchSharedSummary(token: string): Promise<SharedSummaryResponse> {
  const res = await fetch(`/v1/shared/${encodeURIComponent(token)}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error("This shared summary is no longer available.");
    throw new Error("Failed to load shared summary");
  }
  return (await res.json()) as SharedSummaryResponse;
}

export function resummarizeSharedSSE(
  token: string,
  body: { length: ApiLength },
  callbacks: SseCallbacks,
): AbortController {
  return sseRequest(
    `/v1/shared/${encodeURIComponent(token)}/resummarize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    },
    callbacks,
  );
}

export async function createShare(id: string): Promise<{ token: string; url: string }> {
  const res = await fetch(`/v1/history/${encodeURIComponent(id)}/share`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to create share link");
  return (await res.json()) as { token: string; url: string };
}

export async function deleteShare(id: string): Promise<void> {
  const res = await fetch(`/v1/history/${encodeURIComponent(id)}/share`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to remove share link");
}
```

- [ ] **Step 3: Add shared route to App component**

In `apps/web/src/app.tsx`, add import:

```typescript
import { SharedSummaryView } from "./components/shared-summary-view.js";
```

The shared view must render WITHOUT auth — add it before the auth check. After the `if (!authChecked)` loading state block (around line 61), add:

```typescript
  // Shared view is public — render without auth
  if (route.view === "shared") {
    return <SharedSummaryView token={route.token} />;
  }
```

Also update the `<main>` block to be complete (the `route.view === "shared"` case is already handled above, but for type narrowing):

No other change needed — the early return handles it.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/router.tsx apps/web/src/lib/api.ts apps/web/src/app.tsx
git commit -m "feat: add share route, API client functions, and app routing"
```

---

### Task 5: Frontend — SharedSummaryView component

**Files:**

- Create: `apps/web/src/components/shared-summary-view.tsx`

- [ ] **Step 1: Create SharedSummaryView component**

Create `apps/web/src/components/shared-summary-view.tsx`:

```tsx
import { useEffect, useRef, useState } from "preact/hooks";
import {
  type ApiLength,
  type SharedSummaryResponse,
  type SseCallbacks,
  fetchSharedSummary,
  resummarizeSharedSSE,
} from "../lib/api.js";
import { formatDate, formatDuration } from "../lib/format.js";
import { StreamingMarkdown } from "./streaming-markdown.js";
import "../styles/markdown.css";

const LENGTH_OPTIONS: Array<{ key: ApiLength; label: string }> = [
  { key: "short", label: "Short" },
  { key: "medium", label: "Medium" },
  { key: "long", label: "Long" },
  { key: "xlarge", label: "XL" },
];

function toApiLength(inputLength: string): ApiLength | null {
  switch (inputLength) {
    case "short":
      return "short";
    case "medium":
      return "medium";
    case "long":
      return "long";
    case "xl":
    case "xxl":
      return "xlarge";
    default:
      return null;
  }
}

function toDisplayLabel(inputLength: string): string {
  switch (inputLength) {
    case "short":
      return "Short";
    case "medium":
      return "Medium";
    case "long":
      return "Long";
    case "xl":
      return "XL";
    case "xxl":
      return "XXL";
    default:
      return inputLength;
  }
}

export function SharedSummaryView({ token }: { token: string }) {
  const [data, setData] = useState<SharedSummaryResponse | null>(null);
  const [error, setError] = useState("");
  const [resummarizing, setResummarizing] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [resummarizeError, setResummarizeError] = useState<string | null>(null);
  const [currentLength, setCurrentLength] = useState<string>("");
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSharedSummary(token)
      .then((d) => {
        setData(d);
        setCurrentLength(d.inputLength);
      })
      .catch((err) => setError(err.message));
  }, [token]);

  // Close dropdown on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const handleResummarize = (length: ApiLength) => {
    if (resummarizing) return;
    setOpen(false);
    setResummarizing(true);
    setStreamedText("");
    setResummarizeError(null);

    abortRef.current = resummarizeSharedSSE(
      token,
      { length },
      {
        onChunk: (text) => setStreamedText((prev) => prev + text),
        onDone: () => {
          setResummarizing(false);
          setCurrentLength(length === "xlarge" ? "xl" : length);
        },
        onError: (message) => {
          setResummarizing(false);
          setResummarizeError(message);
        },
      },
    );
  };

  if (error) {
    return (
      <div class="container" style={{ maxWidth: "720px", margin: "0 auto", padding: "24px" }}>
        <SharedHeader />
        <div style={{ padding: "48px 0", textAlign: "center", color: "var(--muted)" }}>{error}</div>
        <SharedFooter />
      </div>
    );
  }

  if (!data) {
    return (
      <div class="container" style={{ maxWidth: "720px", margin: "0 auto", padding: "24px" }}>
        <SharedHeader />
        <div style={{ padding: "48px 0", textAlign: "center", color: "var(--muted)" }}>
          Loading\u2026
        </div>
      </div>
    );
  }

  const currentApiLength = toApiLength(currentLength);
  const meta = data.metadata;

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "0 24px" }}>
      <SharedHeader />

      <div style={{ padding: "28px 0" }}>
        {/* Title */}
        {data.title && (
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "26px",
              fontWeight: 400,
              margin: "0 0 6px",
              color: "var(--text)",
              lineHeight: 1.3,
            }}
          >
            {data.title}
          </h1>
        )}

        {/* Source link */}
        {data.sourceUrl && (
          <a
            href={data.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "13px",
              color: "var(--muted)",
              textDecoration: "none",
              display: "inline-block",
              marginBottom: "16px",
            }}
          >
            {"\u2197 "}
            {truncateUrl(data.sourceUrl)}
          </a>
        )}

        {/* Metadata badges */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
          <Badge color="var(--badge-article)">{data.sourceType}</Badge>
          <Badge>{data.model}</Badge>
          <Badge>{toDisplayLabel(currentLength)}</Badge>
          {meta.mediaDurationSeconds != null && (
            <Badge>{formatDuration(meta.mediaDurationSeconds)}</Badge>
          )}
          {meta.wordCount != null && <Badge>{meta.wordCount.toLocaleString()} words</Badge>}
          <Badge>{formatDate(data.createdAt)}</Badge>
        </div>

        {/* Length switcher */}
        {data.sourceType !== "text" && (
          <div
            ref={wrapperRef}
            style={{ position: "relative", display: "inline-block", marginBottom: "20px" }}
          >
            <button
              type="button"
              onClick={() => !resummarizing && setOpen(!open)}
              disabled={resummarizing}
              style={{
                padding: "5px 12px",
                fontSize: "12px",
                fontWeight: "600",
                fontFamily: "var(--font-body)",
                color: resummarizing ? "var(--muted)" : "var(--text)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                cursor: resummarizing ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                whiteSpace: "nowrap",
              }}
            >
              {resummarizing ? (
                <>
                  <Spinner />
                  {" Resummarizing\u2026"}
                </>
              ) : (
                <>
                  {"\u2195 "}
                  {toDisplayLabel(currentLength)}
                  {" \u25BE"}
                </>
              )}
            </button>

            {open && !resummarizing && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  boxShadow: "var(--shadow-md)",
                  padding: "4px",
                  zIndex: 5,
                  minWidth: "140px",
                }}
              >
                {LENGTH_OPTIONS.map((opt) => {
                  const isCurrent = opt.key === currentApiLength;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={isCurrent}
                      onClick={() => handleResummarize(opt.key)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "6px 10px",
                        fontSize: "13px",
                        fontFamily: "var(--font-body)",
                        color: isCurrent ? "var(--accent)" : "var(--text)",
                        background: isCurrent
                          ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                          : "transparent",
                        border: "none",
                        borderRadius: "6px",
                        cursor: isCurrent ? "default" : "pointer",
                        textAlign: "left" as const,
                      }}
                    >
                      {opt.label}
                      {isCurrent && (
                        <span style={{ marginLeft: "6px", fontSize: "11px", opacity: 0.7 }}>
                          current
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Resummarize error */}
        {resummarizeError && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: "12px",
              fontSize: "13px",
              color: "var(--error-text)",
              background: "var(--danger-bg)",
              border: "1px solid var(--danger-border)",
              borderRadius: "8px",
            }}
          >
            {resummarizeError}
          </div>
        )}

        {/* Divider */}
        <div style={{ borderTop: "1px solid var(--border)", marginBottom: "20px" }} />

        {/* Summary */}
        <StreamingMarkdown text={resummarizing ? streamedText : data.summary} />
      </div>

      <SharedFooter />
    </div>
  );
}

function SharedHeader() {
  return (
    <div
      style={{
        padding: "12px 0",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "16px",
          color: "var(--accent)",
          letterSpacing: "-0.3px",
        }}
      >
        Summarize
      </span>
      <span style={{ fontSize: "11px", color: "var(--muted)" }}>Shared summary</span>
    </div>
  );
}

function SharedFooter() {
  return (
    <div
      style={{
        padding: "16px 0",
        borderTop: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: "12px",
        color: "var(--muted)",
      }}
    >
      <span>
        Created with{" "}
        <a
          href="https://summarize.sh"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", textDecoration: "none" }}
        >
          Summarize
        </a>
      </span>
      <span style={{ opacity: 0.6 }}>Content is AI-generated</span>
    </div>
  );
}

function Badge({ children, color }: { children: preact.ComponentChildren; color?: string }) {
  return (
    <span
      style={{
        padding: "3px 10px",
        fontSize: "11px",
        background: color ? `color-mix(in srgb, ${color} 15%, transparent)` : "var(--surface)",
        color: color ?? "var(--muted)",
        borderRadius: "12px",
        border: color ? "none" : "1px solid var(--border)",
      }}
    >
      {children}
    </span>
  );
}

function Spinner() {
  return (
    <>
      <span
        style={{
          display: "inline-block",
          width: "10px",
          height: "10px",
          border: "2px solid var(--border-strong)",
          borderTopColor: "var(--accent)",
          borderRadius: "50%",
          animation: "spin 600ms linear infinite",
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  );
}

function truncateUrl(url: string, maxLen = 50): string {
  try {
    const u = new URL(url);
    const display = u.hostname + u.pathname;
    return display.length > maxLen ? display.slice(0, maxLen - 1) + "\u2026" : display;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen - 1) + "\u2026" : url;
  }
}
```

- [ ] **Step 2: Build and verify**

Run: `pnpm -C apps/web build`
Expected: Build succeeds without TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/shared-summary-view.tsx
git commit -m "feat: add SharedSummaryView component for public share page"
```

---

### Task 6: Frontend — Share button in SummaryDetail

**Files:**

- Create: `apps/web/src/components/share-button.tsx`
- Modify: `apps/web/src/components/summary-detail.tsx`

- [ ] **Step 1: Create ShareButton component**

Create `apps/web/src/components/share-button.tsx`:

```tsx
import { useEffect, useRef, useState } from "preact/hooks";
import { createShare, deleteShare } from "../lib/api.js";

type Props = {
  entryId: string;
  sharedToken: string | null;
  onShareChange: (token: string | null) => void;
};

export function ShareButton({ entryId, sharedToken, onShareChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showBar, setShowBar] = useState(sharedToken != null);
  const copiedTimeout = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setShowBar(sharedToken != null);
  }, [sharedToken]);

  useEffect(
    () => () => {
      clearTimeout(copiedTimeout.current);
    },
    [],
  );

  const shareUrl = sharedToken ? `${window.location.origin}/share/${sharedToken}` : null;

  const handleShare = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { token } = await createShare(entryId);
      onShareChange(token);
      // Copy to clipboard immediately
      await navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
      setCopied(true);
      copiedTimeout.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create share link");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    copiedTimeout.current = setTimeout(() => setCopied(false), 2000);
  };

  const handleUnshare = async () => {
    if (!confirm("Remove the public share link? Anyone with the link will lose access.")) return;
    setLoading(true);
    try {
      await deleteShare(entryId);
      onShareChange(null);
      setCopied(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove share link");
    } finally {
      setLoading(false);
    }
  };

  const isShared = sharedToken != null;

  return (
    <div>
      <button
        type="button"
        onClick={() => (isShared ? setShowBar(!showBar) : handleShare())}
        disabled={loading}
        style={{
          padding: "5px 12px",
          fontSize: "12px",
          fontWeight: "600",
          fontFamily: "var(--font-body)",
          color: isShared ? "var(--accent)" : "var(--text)",
          background: isShared
            ? "color-mix(in srgb, var(--accent) 10%, transparent)"
            : "var(--surface)",
          border: `1px solid ${isShared ? "color-mix(in srgb, var(--accent) 25%, transparent)" : "var(--border)"}`,
          borderRadius: "6px",
          cursor: loading ? "wait" : "pointer",
          display: "flex",
          alignItems: "center",
          gap: "5px",
          whiteSpace: "nowrap",
          transition: "all 180ms ease",
        }}
      >
        {isShared ? (
          <>
            <LinkIcon />
            {copied ? "Copied!" : "Shared \u2713"}
          </>
        ) : (
          <>
            <ShareIcon />
            {loading ? "Sharing\u2026" : "Share"}
          </>
        )}
      </button>

      {isShared && showBar && shareUrl && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "6px",
            padding: "6px 10px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
          }}
        >
          <span style={{ color: "var(--muted)", flexShrink: 0 }}>Link:</span>
          <span
            style={{
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {shareUrl}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            style={{
              padding: "2px 8px",
              fontSize: "11px",
              fontFamily: "var(--font-body)",
              color: "var(--accent)",
              background: "color-mix(in srgb, var(--accent) 10%, transparent)",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleUnshare}
            disabled={loading}
            style={{
              padding: "2px 8px",
              fontSize: "11px",
              fontFamily: "var(--font-body)",
              color: "var(--danger-text)",
              background: "var(--danger-bg)",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Unshare
          </button>
        </div>
      )}
    </div>
  );
}

function ShareIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
```

- [ ] **Step 2: Integrate ShareButton into SummaryDetail**

In `apps/web/src/components/summary-detail.tsx`:

Add import:

```typescript
import { ShareButton } from "./share-button.js";
```

Add state for `sharedToken` tracking. After the `resummarizeError` state declaration (line 51), add:

```typescript
const [sharedToken, setSharedToken] = useState<string | null>(null);
```

In the `useEffect` that fetches the entry (around line 53-62), update to capture `sharedToken`:

```typescript
useEffect(() => {
  setEntry(null);
  setError("");
  setResummarizing(false);
  setStreamedText("");
  setResummarizeError(null);
  setSharedToken(null);
  fetchHistoryDetail(id)
    .then((e) => {
      setEntry(e);
      setSharedToken(e.sharedToken ?? null);
    })
    .catch((err) => setError(err.message));
}, [id]);
```

In the action bar div (around line 103-134), add `ShareButton` after the `LengthSwitcher` closing `)}`:

```tsx
<ShareButton entryId={id} sharedToken={sharedToken} onShareChange={setSharedToken} />
```

- [ ] **Step 3: Build and verify**

Run: `pnpm -C apps/web build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/share-button.tsx apps/web/src/components/summary-detail.tsx
git commit -m "feat: add share button to summary detail view"
```

---

### Task 7: Build, full test, and verify

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 2: Build everything**

Run: `pnpm build`
Expected: Build succeeds (web frontend + lib)

- [ ] **Step 3: Run gate check**

Run: `pnpm check`
Expected: All checks pass (lint, types, tests)

- [ ] **Step 4: Manual smoke test description**

Start dev servers and verify:

1. Open a history entry → Share button visible in action bar
2. Click Share → Link created, copied to clipboard
3. Open the share URL in incognito → Public view loads without login
4. Verify: title, summary, metadata visible; no chat, transcript, media
5. Click length switcher on public view → resummarize works
6. Back in authenticated view → click Unshare → share link removed
7. Reload public URL → 404

- [ ] **Step 5: Final commit — version bump**

```bash
# Update version in package.json
# Then:
git add -A
git commit -m "chore: bump version to v0.13.31"
```
