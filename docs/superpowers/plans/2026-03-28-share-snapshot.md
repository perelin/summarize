# Share Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When sharing a summary, freeze a snapshot of the current summary/title/length/metadata so the shared link shows the state at share-time, not the live state. Add an "Update Share" action to refresh the snapshot without changing the URL.

**Architecture:** Add 4 snapshot columns (`shared_summary`, `shared_title`, `shared_input_length`, `shared_metadata`) to the existing `history` table. On share-create, copy live values into snapshot columns. `GET /shared/:token` reads from snapshot columns. A new `PUT /history/:id/share` endpoint refreshes the snapshot. Revoke clears both token and snapshot columns.

**Tech Stack:** SQLite (better-sqlite3), Hono (server routes), Preact (frontend), Vitest (tests)

---

## File Structure

| File                                       | Action | Responsibility                                                                                                            |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| `src/history.ts`                           | Modify | Add snapshot columns, migration, `updateShareSnapshot` method, change `setShareToken`/`clearShareToken`/`getByShareToken` |
| `src/server/routes/shared.ts`              | Modify | Snapshot on create, serve snapshot on GET, add `PUT /history/:id/share` for refresh                                       |
| `apps/web/src/lib/api.ts`                  | Modify | Add `updateShare(id)` API function                                                                                        |
| `apps/web/src/components/share-button.tsx` | Modify | Add "Update" button in share bar                                                                                          |
| `tests/server.share.test.ts`               | Modify | Add snapshot behavior tests                                                                                               |

---

### Task 1: Database — Add snapshot columns and migration

**Files:**

- Modify: `src/history.ts:120-163` (schema + migration)
- Test: `tests/server.share.test.ts`

- [ ] **Step 1: Write failing test — snapshot columns exist after migration**

Add to `tests/server.share.test.ts` in the "History share token operations" describe block:

```typescript
it("setShareToken stores snapshot data alongside token", () => {
  const result = store.setShareToken("entry-1", "test-user", "tok_abc123", {
    summary: "A summary of the article.",
    title: "Test Article",
    inputLength: "short",
    metadata: null,
  });
  expect(result).toBe(true);

  const entry = store.getByShareToken("tok_abc123");
  expect(entry).not.toBeNull();
  expect(entry!.sharedSummary).toBe("A summary of the article.");
  expect(entry!.sharedTitle).toBe("Test Article");
  expect(entry!.sharedInputLength).toBe("short");
  expect(entry!.sharedMetadata).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: FAIL — `setShareToken` doesn't accept snapshot arg, `sharedSummary` not on type

- [ ] **Step 3: Add snapshot columns to schema and migration in `src/history.ts`**

In the `CREATE TABLE` statement (line 120), add after `shared_token TEXT`:

```sql
shared_summary      TEXT,
shared_title        TEXT,
shared_input_length TEXT,
shared_metadata     TEXT
```

Add migration block after the `shared_token` migration (line 152):

```typescript
// Migrate: add shared snapshot columns if missing
if (!colInfo.some((col) => col.name === "shared_summary")) {
  db.exec("ALTER TABLE history ADD COLUMN shared_summary TEXT");
  db.exec("ALTER TABLE history ADD COLUMN shared_title TEXT");
  db.exec("ALTER TABLE history ADD COLUMN shared_input_length TEXT");
  db.exec("ALTER TABLE history ADD COLUMN shared_metadata TEXT");
}
```

- [ ] **Step 4: Add `ShareSnapshot` type and update `HistoryEntry` type**

Add new type:

```typescript
export type ShareSnapshot = {
  summary: string;
  title: string | null;
  inputLength: string;
  metadata: string | null;
};
```

Add to `HistoryEntry`:

```typescript
sharedSummary: string | null;
sharedTitle: string | null;
sharedInputLength: string | null;
sharedMetadata: string | null;
```

Update `mapRow` to include:

```typescript
sharedSummary: (row.shared_summary as string) ?? null,
sharedTitle: (row.shared_title as string) ?? null,
sharedInputLength: (row.shared_input_length as string) ?? null,
sharedMetadata: (row.shared_metadata as string) ?? null,
```

- [ ] **Step 5: Update `setShareToken` to accept and store snapshot**

Change the `HistoryStore` type signature:

```typescript
setShareToken: (id: string, account: string, token: string, snapshot: ShareSnapshot) => boolean;
```

Update the prepared statement:

```typescript
const stmtSetShareToken = db.prepare(
  `UPDATE history
   SET shared_token = ?, shared_summary = ?, shared_title = ?, shared_input_length = ?, shared_metadata = ?
   WHERE id = ? AND account = ? AND shared_token IS NULL`,
);
```

Update the function:

```typescript
const setShareToken = (
  id: string,
  account: string,
  token: string,
  snapshot: ShareSnapshot,
): boolean => {
  const result = stmtSetShareToken.run(
    token,
    snapshot.summary,
    snapshot.title,
    snapshot.inputLength,
    snapshot.metadata,
    id,
    account,
  ) as { changes?: number };
  return typeof result?.changes === "number" ? result.changes > 0 : false;
};
```

- [ ] **Step 6: Update `clearShareToken` to also clear snapshot columns**

Update the prepared statement:

```typescript
const stmtClearShareToken = db.prepare(
  `UPDATE history
   SET shared_token = NULL, shared_summary = NULL, shared_title = NULL,
       shared_input_length = NULL, shared_metadata = NULL
   WHERE id = ? AND account = ? AND shared_token IS NOT NULL`,
);
```

- [ ] **Step 7: Add `updateShareSnapshot` method**

Add to `HistoryStore` type:

```typescript
updateShareSnapshot: (id: string, account: string, snapshot: ShareSnapshot) => boolean;
```

Add prepared statement:

```typescript
const stmtUpdateShareSnapshot = db.prepare(
  `UPDATE history
   SET shared_summary = ?, shared_title = ?, shared_input_length = ?, shared_metadata = ?
   WHERE id = ? AND account = ? AND shared_token IS NOT NULL`,
);
```

Add function:

```typescript
const updateShareSnapshot = (id: string, account: string, snapshot: ShareSnapshot): boolean => {
  const result = stmtUpdateShareSnapshot.run(
    snapshot.summary,
    snapshot.title,
    snapshot.inputLength,
    snapshot.metadata,
    id,
    account,
  ) as { changes?: number };
  return typeof result?.changes === "number" ? result.changes > 0 : false;
};
```

Return it from `createHistoryStore`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: PASS — but existing tests that call `setShareToken` with 3 args will fail. Update them in next step.

- [ ] **Step 9: Fix existing tests to pass snapshot to `setShareToken`**

Every existing call to `store.setShareToken("entry-1", "test-user", "tok_...")` needs a 4th argument. Add a helper in the test file:

```typescript
const defaultSnapshot = {
  summary: "A summary of the article.",
  title: "Test Article",
  inputLength: "short",
  metadata: null,
};
```

Update all `setShareToken` calls to pass `defaultSnapshot` as the 4th arg.

- [ ] **Step 10: Run tests to verify all pass**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: ALL PASS

- [ ] **Step 11: Commit**

```bash
git add src/history.ts tests/server.share.test.ts
git commit -m "feat: add share snapshot columns and updateShareSnapshot method"
```

---

### Task 2: Server routes — Snapshot on create, serve snapshot, add update endpoint

**Files:**

- Modify: `src/server/routes/shared.ts`
- Test: `tests/server.share.test.ts`

- [ ] **Step 1: Write failing test — GET /shared/:token returns snapshot, not live data**

Add to `tests/server.share.test.ts` in the "Share API routes" describe block:

```typescript
it("GET /shared/:token returns snapshot, not live data after updateSummary", async () => {
  // Share at current state (summary = "A summary of the article.", length = "short")
  const shareRes = await app.request("/v1/history/entry-1/share", { method: "POST" });
  const { token } = await shareRes.json();

  // Owner changes summary via updateSummary (simulates resummarize)
  store.updateSummary("entry-1", "test-user", {
    summary: "A completely new long summary.",
    inputLength: "long",
    model: "new-model",
    title: "New Title",
    metadata: null,
  });

  // Shared view should still show the OLD snapshot
  const res = await app.request(`/v1/shared/${token}`);
  const body = await res.json();
  expect(body.summary).toBe("A summary of the article.");
  expect(body.inputLength).toBe("short");
  expect(body.title).toBe("Test Article");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: FAIL — `body.summary` is "A completely new long summary." (live data, not snapshot)

- [ ] **Step 3: Update `POST /history/:id/share` to pass snapshot when creating token**

In `src/server/routes/shared.ts`, update the share creation handler (line 45). After fetching the entry, build a snapshot and pass it to `setShareToken`:

```typescript
route.post("/history/:id/share", (c) => {
  const account = c.get("account") as string;
  const id = c.req.param("id");

  const entry = deps.historyStore.getById(id, account);
  if (!entry) {
    return c.json({ error: { code: "NOT_FOUND", message: "History entry not found" } }, 404);
  }

  // Check for existing token (idempotent)
  const existing = deps.historyStore.getShareToken(id, account);
  if (existing) {
    const proto = c.req.header("x-forwarded-proto") ?? "https";
    const host = c.req.header("host") ?? "localhost";
    return c.json({ token: existing, url: `${proto}://${host}/share/${existing}` });
  }

  const token = randomBytes(9).toString("base64url").slice(0, 12);
  const stored = deps.historyStore.setShareToken(id, account, token, {
    summary: entry.summary,
    title: entry.title,
    inputLength: entry.inputLength,
    metadata: entry.metadata,
  });

  const proto = c.req.header("x-forwarded-proto") ?? "https";
  const host = c.req.header("host") ?? "localhost";

  if (!stored) {
    const raceToken = deps.historyStore.getShareToken(id, account);
    if (raceToken) {
      return c.json({ token: raceToken, url: `${proto}://${host}/share/${raceToken}` });
    }
    return c.json({ error: { code: "STORE_FAILED", message: "Failed to create share link" } }, 500);
  }

  return c.json({ token, url: `${proto}://${host}/share/${token}` });
});
```

- [ ] **Step 4: Update `GET /shared/:token` to serve snapshot columns**

Replace the handler body to read from snapshot fields instead of live fields:

```typescript
route.get("/shared/:token", (c) => {
  const token = c.req.param("token");
  if (!/^[A-Za-z0-9_-]{12}$/.test(token)) {
    return c.json({ error: { code: "NOT_FOUND", message: "Shared content not found" } }, 404);
  }
  const entry = deps.historyStore.getByShareToken(token);
  if (!entry) {
    return c.json({ error: { code: "NOT_FOUND", message: "Shared content not found" } }, 404);
  }

  // Serve from snapshot columns (frozen at share/update time)
  const summary = entry.sharedSummary ?? entry.summary;
  const title = entry.sharedTitle ?? entry.title;
  const inputLength = entry.sharedInputLength ?? entry.inputLength;
  const metadataRaw = entry.sharedMetadata ?? entry.metadata;

  let mediaDurationSeconds: number | null = null;
  let wordCount: number | null = null;
  if (metadataRaw) {
    try {
      const parsed = JSON.parse(metadataRaw);
      if (typeof parsed.mediaDurationSeconds === "number") {
        mediaDurationSeconds = parsed.mediaDurationSeconds;
      }
      if (typeof parsed.wordCount === "number") {
        wordCount = parsed.wordCount;
      }
    } catch {
      // ignore malformed metadata
    }
  }

  return c.json({
    title,
    summary,
    sourceUrl: entry.sourceUrl,
    sourceType: entry.sourceType,
    model: entry.model,
    createdAt: entry.createdAt,
    inputLength,
    metadata: { mediaDurationSeconds, wordCount },
  });
});
```

Note: the fallback `?? entry.summary` handles pre-existing shares that have no snapshot columns yet (backward compatibility for already-shared entries).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: PASS

- [ ] **Step 6: Write failing test — PUT /history/:id/share refreshes snapshot**

```typescript
it("PUT /v1/history/:id/share refreshes snapshot without changing token", async () => {
  // Share at original state
  const shareRes = await app.request("/v1/history/entry-1/share", { method: "POST" });
  const { token } = await shareRes.json();

  // Owner changes summary
  store.updateSummary("entry-1", "test-user", {
    summary: "Updated summary text.",
    inputLength: "long",
    model: "new-model",
    title: "Updated Title",
    metadata: JSON.stringify({ mediaDurationSeconds: 120, wordCount: 800 }),
  });

  // Update the share (refresh snapshot)
  const updateRes = await app.request("/v1/history/entry-1/share", { method: "PUT" });
  expect(updateRes.status).toBe(200);
  const updateBody = await updateRes.json();
  expect(updateBody.token).toBe(token); // same token

  // Shared view should now show the updated data
  const res = await app.request(`/v1/shared/${token}`);
  const body = await res.json();
  expect(body.summary).toBe("Updated summary text.");
  expect(body.inputLength).toBe("long");
  expect(body.title).toBe("Updated Title");
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: FAIL — PUT handler doesn't exist (405)

- [ ] **Step 8: Add `PUT /history/:id/share` handler**

Add to `src/server/routes/shared.ts` after the POST handler:

```typescript
// PUT /history/:id/share — refresh snapshot (keep token stable)
route.put("/history/:id/share", (c) => {
  const account = c.get("account") as string;
  const id = c.req.param("id");

  const entry = deps.historyStore.getById(id, account);
  if (!entry) {
    return c.json({ error: { code: "NOT_FOUND", message: "History entry not found" } }, 404);
  }

  const existing = deps.historyStore.getShareToken(id, account);
  if (!existing) {
    return c.json({ error: { code: "NOT_SHARED", message: "Entry is not shared" } }, 404);
  }

  deps.historyStore.updateShareSnapshot(id, account, {
    summary: entry.summary,
    title: entry.title,
    inputLength: entry.inputLength,
    metadata: entry.metadata,
  });

  const proto = c.req.header("x-forwarded-proto") ?? "https";
  const host = c.req.header("host") ?? "localhost";
  return c.json({ token: existing, url: `${proto}://${host}/share/${existing}` });
});
```

- [ ] **Step 9: Run tests to verify all pass**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: ALL PASS

- [ ] **Step 10: Write test — PUT returns 404 when not shared**

```typescript
it("PUT /v1/history/:id/share returns 404 when not shared", async () => {
  const res = await app.request("/v1/history/entry-1/share", { method: "PUT" });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 11: Run test to verify it passes**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: PASS

- [ ] **Step 12: Update OG image endpoint to use snapshot data**

In the `GET /shared/:token/og-image` handler, apply the same snapshot fallback logic:

```typescript
const summary = entry.sharedSummary ?? entry.summary;
const title = entry.sharedTitle ?? entry.title;
const metadataRaw = entry.sharedMetadata ?? entry.metadata;
```

Use `summary`, `title`, and `metadataRaw` instead of `entry.summary`, `entry.title`, and `entry.metadata` when calling `renderOgImage` and parsing metadata.

- [ ] **Step 13: Commit**

```bash
git add src/server/routes/shared.ts tests/server.share.test.ts
git commit -m "feat: share creates snapshot, add PUT endpoint to refresh"
```

---

### Task 3: Frontend — Add `updateShare` API and "Update" button

**Files:**

- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/share-button.tsx`

- [ ] **Step 1: Add `updateShare` function to `apps/web/src/lib/api.ts`**

Add after the `deleteShare` function:

```typescript
export async function updateShare(id: string): Promise<{ token: string; url: string }> {
  const res = await fetch(`/v1/history/${encodeURIComponent(id)}/share`, {
    method: "PUT",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to update share link");
  return (await res.json()) as { token: string; url: string };
}
```

- [ ] **Step 2: Add "Update" button to `apps/web/src/components/share-button.tsx`**

Import `updateShare`:

```typescript
import { createShare, deleteShare, updateShare } from "../lib/api.js";
```

Add handler inside the `ShareButton` component, after `handleUnshare`:

```typescript
const handleUpdate = async () => {
  setBusy(true);
  try {
    await updateShare(entryId);
    setCopied(false);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update share link";
    alert(msg);
  } finally {
    setBusy(false);
  }
};
```

Add the "Update" button in the share bar (the `{showBar && shareUrl && (...)}` section), between the "Copy" and "Unshare" buttons:

```tsx
<button
  type="button"
  disabled={busy}
  onClick={() => void handleUpdate()}
  style={{
    padding: "3px 8px",
    fontSize: "11px",
    fontWeight: "500",
    fontFamily: "var(--font-body)",
    color: "var(--text)",
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    cursor: busy ? "wait" : "pointer",
    whiteSpace: "nowrap",
  }}
>
  Update
</button>
```

- [ ] **Step 3: Build frontend and run tests**

Run: `pnpm -C apps/web build && pnpm vitest run tests/server.share.test.ts`
Expected: Build succeeds, all tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/components/share-button.tsx
git commit -m "feat: add Update button to refresh share snapshot"
```

---

### Task 4: Full integration test — verify end-to-end snapshot isolation

**Files:**

- Test: `tests/server.share.test.ts`

- [ ] **Step 1: Write integration test covering full lifecycle**

```typescript
it("full lifecycle: share → change → shared shows old → update → shared shows new → unshare → 404", async () => {
  // 1. Share
  const shareRes = await app.request("/v1/history/entry-1/share", { method: "POST" });
  const { token } = await shareRes.json();

  // 2. Owner changes summary
  store.updateSummary("entry-1", "test-user", {
    summary: "Version 2 of the summary.",
    inputLength: "long",
    model: "model-v2",
    title: "Title v2",
    metadata: null,
  });

  // 3. Shared view still shows original
  const snap1 = await (await app.request(`/v1/shared/${token}`)).json();
  expect(snap1.summary).toBe("A summary of the article.");

  // 4. Owner refreshes the share
  const updateRes = await app.request("/v1/history/entry-1/share", { method: "PUT" });
  expect(updateRes.status).toBe(200);

  // 5. Shared view now shows v2
  const snap2 = await (await app.request(`/v1/shared/${token}`)).json();
  expect(snap2.summary).toBe("Version 2 of the summary.");
  expect(snap2.inputLength).toBe("long");

  // 6. Token is still the same
  const { token: sameToken } = await updateRes.json();
  expect(sameToken).toBe(token);

  // 7. Unshare
  const delRes = await app.request("/v1/history/entry-1/share", { method: "DELETE" });
  expect(delRes.status).toBe(204);

  // 8. Shared link is dead
  const gone = await app.request(`/v1/shared/${token}`);
  expect(gone.status).toBe(404);
});
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm vitest run tests/server.share.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Run the full project test suite**

Run: `pnpm vitest run`
Expected: ALL PASS (no regressions)

- [ ] **Step 4: Commit**

```bash
git add tests/server.share.test.ts
git commit -m "test: add full share snapshot lifecycle integration test"
```
