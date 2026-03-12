# Summarization History Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every successful API summarization as permanent, browsable history with a web UI for viewing past summaries, transcripts, and media.

**Architecture:** Separate `history.sqlite` database alongside existing `cache.sqlite`. History is recorded non-blockingly after each successful `POST /v1/summarize`. New Hono routes serve history data. Existing `index.html` extends with a History tab.

**Tech Stack:** SQLite (via existing `openSqlite` wrapper), Hono routes, vanilla JS frontend, vitest for tests.

**Spec:** `docs/superpowers/specs/2026-03-12-summarization-history-design.md`

---

## File Structure

**New files:**

| File                           | Responsibility                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `src/sqlite.ts`                | Shared SQLite utilities: `openSqlite`, `SqliteDatabase`, `SqliteStatement` types                             |
| `src/history.ts`               | History SQLite store: open DB, create table, CRUD operations                                                 |
| `src/run/history-state.ts`     | Config-to-store factory (mirrors `cache-state.ts` / `media-cache-state.ts`)                                  |
| `src/server/routes/history.ts` | Hono routes: `GET /v1/history`, `GET /v1/history/:id`, `GET /v1/history/:id/media`, `DELETE /v1/history/:id` |
| `tests/history.test.ts`        | Unit tests for `HistoryStore` CRUD                                                                           |
| `tests/server.history.test.ts` | Integration tests for history API routes                                                                     |

**Modified files:**

| File                             | Change                                                                      |
| -------------------------------- | --------------------------------------------------------------------------- |
| `src/cache.ts`                   | Import `openSqlite` from shared `src/sqlite.ts` instead of defining locally |
| `src/config/types.ts`            | Add `history?` section to `SummarizeConfig`                                 |
| `src/daemon/summarize.ts`        | Extend `streamSummaryForUrl` return to include `extracted`                  |
| `src/server/middleware/auth.ts`  | Support query param `?token=` fallback for media streaming                  |
| `src/server/routes/summarize.ts` | Add `HistoryStore` to deps; fire-and-forget recording after response        |
| `src/server/index.ts`            | Wire history routes + pass `historyStore` through deps                      |
| `src/server/main.ts`             | Bootstrap `HistoryStore` from config                                        |
| `src/server/public/index.html`   | Add History tab, list view, detail view                                     |

---

## Chunk 1: History Store (Core)

### Task 1: Config types

**Files:**

- Modify: `src/config/types.ts:169-243`

- [ ] **Step 1: Write the failing test**

Create `tests/history.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

describe("history config types", () => {
  it("SummarizeConfig accepts history section", async () => {
    const { type } = await import("../src/config/types.js");
    // Type-level test: this should compile
    const config: import("../src/config/types.js").SummarizeConfig = {
      history: {
        enabled: true,
        path: "~/.summarize/history.sqlite",
        mediaPath: "~/.summarize/history/media/",
      },
    };
    expect(config.history?.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/history.test.ts`
Expected: FAIL — `history` property does not exist on `SummarizeConfig`

- [ ] **Step 3: Add history config type**

In `src/config/types.ts`, add after the `cache` section (after line 190):

```typescript
  /**
   * History settings for persisting summarization results.
   */
  history?: {
    enabled?: boolean;
    path?: string;
    mediaPath?: string;
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/history.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/types.ts tests/history.test.ts
git commit -m "feat(history): add history config types"
```

---

### Task 2: History store — SQLite init and insert

**Files:**

- Create: `src/history.ts`
- Test: `tests/history.test.ts`

- [ ] **Step 1: Write failing tests for store creation and insert**

Append to `tests/history.test.ts`:

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach } from "vitest";
import type { HistoryStore, HistoryEntry } from "../src/history.js";
import { createHistoryStore, resolveHistoryPath } from "../src/history.js";

describe("resolveHistoryPath", () => {
  it("returns default path when no override", () => {
    const path = resolveHistoryPath({ env: { HOME: "/home/user" }, historyPath: null });
    expect(path).toBe("/home/user/.summarize/history.sqlite");
  });

  it("expands ~ in custom path", () => {
    const path = resolveHistoryPath({
      env: { HOME: "/home/user" },
      historyPath: "~/custom/history.db",
    });
    expect(path).toBe("/home/user/custom/history.db");
  });

  it("returns null when HOME is missing", () => {
    const path = resolveHistoryPath({ env: {}, historyPath: null });
    expect(path).toBeNull();
  });

  it("respects absolute path", () => {
    const path = resolveHistoryPath({
      env: { HOME: "/home/user" },
      historyPath: "/tmp/my-history.db",
    });
    expect(path).toBe("/tmp/my-history.db");
  });
});

describe("HistoryStore", () => {
  let tmpDir: string;
  let store: HistoryStore;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "history-test-"));
    store = await createHistoryStore({ path: join(tmpDir, "history.sqlite") });
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("inserts and retrieves a history entry", () => {
    const entry: HistoryEntry = {
      id: "test-uuid-1",
      createdAt: new Date().toISOString(),
      sourceUrl: "https://example.com/article",
      sourceType: "article",
      inputLength: "short",
      model: "anthropic/claude-sonnet-4",
      title: "Test Article",
      summary: "# Test\n\nThis is a summary.",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      metadata: JSON.stringify({ costUsd: 0.004 }),
    };

    store.insert(entry);
    const result = store.getById("test-uuid-1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("test-uuid-1");
    expect(result!.title).toBe("Test Article");
    expect(result!.summary).toBe("# Test\n\nThis is a summary.");
    expect(result!.sourceUrl).toBe("https://example.com/article");
  });

  it("returns null for non-existent entry", () => {
    const result = store.getById("does-not-exist");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/history.test.ts`
Expected: FAIL — `src/history.js` does not exist

- [ ] **Step 3: Implement history store**

First, extract shared SQLite utilities. Create `src/sqlite.ts`:

```typescript
export type SqliteStatement = {
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
  run: (...args: unknown[]) => { changes?: number } | unknown;
};

export type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close?: () => void;
};

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
let warningFilterInstalled = false;

const installSqliteWarningFilter = () => {
  if (warningFilterInstalled) return;
  warningFilterInstalled = true;
  const original = process.emitWarning.bind(process);
  process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
    const message =
      typeof warning === "string"
        ? warning
        : warning && typeof (warning as { message?: unknown }).message === "string"
          ? String((warning as { message?: unknown }).message)
          : "";
    const type =
      typeof args[0] === "string" ? args[0] : (args[0] as { type?: unknown } | undefined)?.type;
    const name = (warning as { name?: unknown } | undefined)?.name;
    const normalizedType = typeof type === "string" ? type : typeof name === "string" ? name : "";
    if (normalizedType === "ExperimentalWarning" && message.toLowerCase().includes("sqlite")) {
      return;
    }
    return original(warning as never, ...(args as [never]));
  }) as typeof process.emitWarning;
};

export async function openSqlite(path: string): Promise<SqliteDatabase> {
  if (isBun) {
    const mod = (await import("bun:sqlite")) as { Database: new (path: string) => SqliteDatabase };
    return new mod.Database(path);
  }
  installSqliteWarningFilter();
  const mod = (await import("node:sqlite")) as unknown as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  return new mod.DatabaseSync(path);
}
```

Then update `src/cache.ts` to import from `src/sqlite.ts` instead of defining its own `openSqlite`. Replace the local `SqliteStatement`, `SqliteDatabase` types, `isBun`, `warningFilterInstalled`, `installSqliteWarningFilter`, and `openSqlite` function with:

```typescript
import { openSqlite, type SqliteDatabase, type SqliteStatement } from "./sqlite.js";
```

Now create `src/history.ts`:

```typescript
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { openSqlite } from "./sqlite.js";

export type HistoryEntry = {
  id: string;
  createdAt: string;
  sourceUrl: string | null;
  sourceType: string;
  inputLength: string;
  model: string;
  title: string | null;
  summary: string;
  transcript: string | null;
  mediaPath: string | null;
  mediaSize: number | null;
  mediaType: string | null;
  metadata: string | null;
};

export type HistoryListItem = Omit<HistoryEntry, "transcript"> & {
  hasTranscript: boolean;
  hasMedia: boolean;
};

export type HistoryStore = {
  insert: (entry: HistoryEntry) => void;
  getById: (id: string) => HistoryEntry | null;
  list: (opts: { limit: number; offset: number }) => { entries: HistoryListItem[]; total: number };
  deleteById: (id: string) => boolean;
  close: () => void;
};

export function resolveHistoryPath({
  env,
  historyPath,
}: {
  env: Record<string, string | undefined>;
  historyPath: string | null;
}): string | null {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || null;
  const raw = historyPath?.trim();
  if (raw && raw.length > 0) {
    if (raw.startsWith("~")) {
      if (!home) return null;
      const expanded = raw === "~" ? home : join(home, raw.slice(2));
      return resolvePath(expanded);
    }
    return isAbsolute(raw) ? raw : home ? resolvePath(join(home, raw)) : null;
  }
  if (!home) return null;
  return join(home, ".summarize", "history.sqlite");
}

export function resolveHistoryMediaPath({
  env,
  mediaPath,
}: {
  env: Record<string, string | undefined>;
  mediaPath: string | null;
}): string | null {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || null;
  const raw = mediaPath?.trim();
  if (raw && raw.length > 0) {
    if (raw.startsWith("~")) {
      if (!home) return null;
      const expanded = raw === "~" ? home : join(home, raw.slice(2));
      return resolvePath(expanded);
    }
    return isAbsolute(raw) ? raw : home ? resolvePath(join(home, raw)) : null;
  }
  if (!home) return null;
  return join(home, ".summarize", "history", "media");
}

export async function createHistoryStore({ path }: { path: string }): Promise<HistoryStore> {
  mkdirSync(dirname(path), { recursive: true });
  const db = await openSqlite(path);

  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec("PRAGMA auto_vacuum=INCREMENTAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id            TEXT PRIMARY KEY,
      created_at    TEXT NOT NULL,
      source_url    TEXT,
      source_type   TEXT,
      input_length  TEXT NOT NULL,
      model         TEXT NOT NULL,
      title         TEXT,
      summary       TEXT NOT NULL,
      transcript    TEXT,
      media_path    TEXT,
      media_size    INTEGER,
      media_type    TEXT,
      metadata      TEXT
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC)");

  const stmtInsert = db.prepare(`
    INSERT INTO history (
      id, created_at, source_url, source_type, input_length, model,
      title, summary, transcript, media_path, media_size, media_type, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const stmtGetById = db.prepare("SELECT * FROM history WHERE id = ?");

  const stmtList = db.prepare("SELECT * FROM history ORDER BY created_at DESC LIMIT ? OFFSET ?");

  const stmtCount = db.prepare("SELECT COUNT(*) AS total FROM history");

  const stmtDelete = db.prepare("DELETE FROM history WHERE id = ?");

  const insert = (entry: HistoryEntry): void => {
    stmtInsert.run(
      entry.id,
      entry.createdAt,
      entry.sourceUrl,
      entry.sourceType,
      entry.inputLength,
      entry.model,
      entry.title,
      entry.summary,
      entry.transcript,
      entry.mediaPath,
      entry.mediaSize,
      entry.mediaType,
      entry.metadata,
    );
  };

  const mapRow = (row: Record<string, unknown>): HistoryEntry => ({
    id: row.id as string,
    createdAt: row.created_at as string,
    sourceUrl: (row.source_url as string) ?? null,
    sourceType: (row.source_type as string) ?? "article",
    inputLength: row.input_length as string,
    model: row.model as string,
    title: (row.title as string) ?? null,
    summary: row.summary as string,
    transcript: (row.transcript as string) ?? null,
    mediaPath: (row.media_path as string) ?? null,
    mediaSize: (row.media_size as number) ?? null,
    mediaType: (row.media_type as string) ?? null,
    metadata: (row.metadata as string) ?? null,
  });

  const getById = (id: string): HistoryEntry | null => {
    const row = stmtGetById.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return mapRow(row);
  };

  const list = (opts: {
    limit: number;
    offset: number;
  }): { entries: HistoryListItem[]; total: number } => {
    const countRow = stmtCount.get() as { total?: number } | undefined;
    const total = typeof countRow?.total === "number" ? countRow.total : 0;
    const rows = stmtList.all(opts.limit, opts.offset) as Array<Record<string, unknown>>;
    const entries: HistoryListItem[] = rows.map((row) => {
      const entry = mapRow(row);
      const { transcript, ...rest } = entry;
      return {
        ...rest,
        hasTranscript: transcript != null && transcript.length > 0,
        hasMedia: entry.mediaPath != null && entry.mediaPath.length > 0,
      };
    });
    return { entries, total };
  };

  const deleteById = (id: string): boolean => {
    const result = stmtDelete.run(id) as { changes?: number };
    return typeof result?.changes === "number" ? result.changes > 0 : false;
  };

  const close = (): void => {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // ignore
    }
    db.close?.();
  };

  return { insert, getById, list, deleteById, close };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/history.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/history.ts tests/history.test.ts
git commit -m "feat(history): add history store with SQLite persistence"
```

---

### Task 3: History store — list and delete

**Files:**

- Test: `tests/history.test.ts`
- Modify: `src/history.ts` (already implemented above, just adding tests)

- [ ] **Step 1: Write tests for list and delete**

Append to the `HistoryStore` describe block in `tests/history.test.ts`:

```typescript
it("lists entries in reverse chronological order", () => {
  for (let i = 0; i < 5; i++) {
    store.insert({
      id: `entry-${i}`,
      createdAt: new Date(2026, 2, 12, 10, i).toISOString(),
      sourceUrl: `https://example.com/${i}`,
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: `Article ${i}`,
      summary: `Summary ${i}`,
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      metadata: null,
    });
  }

  const result = store.list({ limit: 3, offset: 0 });
  expect(result.total).toBe(5);
  expect(result.entries).toHaveLength(3);
  expect(result.entries[0].id).toBe("entry-4"); // most recent first
  expect(result.entries[2].id).toBe("entry-2");
  expect(result.entries[0].hasTranscript).toBe(false);
  expect(result.entries[0].hasMedia).toBe(false);
});

it("paginates with offset", () => {
  for (let i = 0; i < 5; i++) {
    store.insert({
      id: `entry-${i}`,
      createdAt: new Date(2026, 2, 12, 10, i).toISOString(),
      sourceUrl: `https://example.com/${i}`,
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: `Article ${i}`,
      summary: `Summary ${i}`,
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      metadata: null,
    });
  }

  const result = store.list({ limit: 2, offset: 3 });
  expect(result.total).toBe(5);
  expect(result.entries).toHaveLength(2);
  expect(result.entries[0].id).toBe("entry-1");
  expect(result.entries[1].id).toBe("entry-0");
});

it("deletes an entry and returns true", () => {
  store.insert({
    id: "to-delete",
    createdAt: new Date().toISOString(),
    sourceUrl: "https://example.com",
    sourceType: "article",
    inputLength: "short",
    model: "test-model",
    title: "Delete Me",
    summary: "Summary",
    transcript: null,
    mediaPath: null,
    mediaSize: null,
    mediaType: null,
    metadata: null,
  });

  expect(store.deleteById("to-delete")).toBe(true);
  expect(store.getById("to-delete")).toBeNull();
});

it("returns false when deleting non-existent entry", () => {
  expect(store.deleteById("nope")).toBe(false);
});

it("sets hasTranscript and hasMedia flags correctly", () => {
  store.insert({
    id: "with-media",
    createdAt: new Date().toISOString(),
    sourceUrl: "https://example.com/podcast.mp3",
    sourceType: "podcast",
    inputLength: "medium",
    model: "test-model",
    title: "Podcast Episode",
    summary: "Summary",
    transcript: "Full transcript text here...",
    mediaPath: "with-media.mp3",
    mediaSize: 5000000,
    mediaType: "audio/mpeg",
    metadata: null,
  });

  const result = store.list({ limit: 10, offset: 0 });
  const entry = result.entries.find((e) => e.id === "with-media")!;
  expect(entry.hasTranscript).toBe(true);
  expect(entry.hasMedia).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm vitest run tests/history.test.ts`
Expected: PASS (implementation already exists from Task 2)

- [ ] **Step 3: Commit**

```bash
git add tests/history.test.ts
git commit -m "test(history): add list, delete, and flag tests for history store"
```

---

### Task 4: History state factory

**Files:**

- Create: `src/run/history-state.ts`
- Test: `tests/history.test.ts`

- [ ] **Step 1: Write failing test**

Append to `tests/history.test.ts`:

```typescript
import { createHistoryStateFromConfig } from "../src/run/history-state.js";

describe("createHistoryStateFromConfig", () => {
  it("returns store when enabled (default)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "history-config-test-"));
    try {
      const store = await createHistoryStateFromConfig({
        envForRun: { HOME: tmpDir },
        config: null,
      });
      expect(store).not.toBeNull();
      store!.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns null when disabled via config", async () => {
    const store = await createHistoryStateFromConfig({
      envForRun: { HOME: "/tmp" },
      config: { history: { enabled: false } },
    });
    expect(store).toBeNull();
  });

  it("returns null when disabled via env var", async () => {
    const store = await createHistoryStateFromConfig({
      envForRun: { HOME: "/tmp", SUMMARIZE_HISTORY_ENABLED: "false" },
      config: null,
    });
    expect(store).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/history.test.ts`
Expected: FAIL — `src/run/history-state.js` does not exist

- [ ] **Step 3: Implement history state factory**

Create `src/run/history-state.ts`:

```typescript
import type { SummarizeConfig } from "../config.js";
import {
  createHistoryStore,
  resolveHistoryPath,
  resolveHistoryMediaPath,
  type HistoryStore,
} from "../history.js";

export async function createHistoryStateFromConfig({
  envForRun,
  config,
}: {
  envForRun: Record<string, string | undefined>;
  config: SummarizeConfig | null;
}): Promise<HistoryStore | null> {
  // Check env var override first
  const envEnabled = envForRun.SUMMARIZE_HISTORY_ENABLED?.trim().toLowerCase();
  if (envEnabled === "false" || envEnabled === "0") return null;

  // Check config
  if (config?.history?.enabled === false) return null;

  const historyPath = resolveHistoryPath({
    env: envForRun,
    historyPath: config?.history?.path ?? null,
  });
  if (!historyPath) return null;

  return createHistoryStore({ path: historyPath });
}

export function resolveHistoryMediaPathFromConfig({
  envForRun,
  config,
}: {
  envForRun: Record<string, string | undefined>;
  config: SummarizeConfig | null;
}): string | null {
  return resolveHistoryMediaPath({
    env: envForRun,
    mediaPath: config?.history?.mediaPath ?? null,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/history.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/run/history-state.ts tests/history.test.ts
git commit -m "feat(history): add history state factory from config"
```

---

## Chunk 2: Server Integration

### Task 5: Extend `streamSummaryForUrl` to return `extracted`

**Files:**

- Modify: `src/daemon/summarize.ts:416-511`

- [ ] **Step 1: Write failing test**

Append to `tests/server.summarize.test.ts`:

```typescript
describe("POST /v1/summarize – streamSummaryForUrl returns extracted", () => {
  it("result includes extracted content", async () => {
    // This is a type-level assertion + integration check
    // The mock already works because we cast as `any`, but the real function
    // should now include `extracted` in its return type.
    const mockResult = {
      usedModel: "test-model",
      report: {
        llm: [],
        services: { firecrawl: { requests: 0 }, apify: { requests: 0 } },
        pipeline: null,
      },
      metrics: {
        elapsedMs: 100,
        summary: "",
        details: null,
        summaryDetailed: "",
        detailsDetailed: null,
        pipeline: null,
      },
      insights: null,
      extracted: {
        url: "https://example.com",
        title: "Test",
        content: "article body",
        transcriptSource: null,
      },
    };
    vi.spyOn(summarizeMod, "streamSummaryForUrl").mockResolvedValueOnce(mockResult as any);

    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Add `extracted` to the return type and value**

In `src/daemon/summarize.ts`, modify the return type of `streamSummaryForUrl` (line 416-420) to include `extracted`:

Change the `Promise<{` return type to:

```typescript
}): Promise<{
  usedModel: string;
  report: RunMetricsReport;
  metrics: VisiblePageMetrics;
  insights: SummarizeInsights;
  extracted: ExtractedLinkContent;
}>
```

And in the return statement (line 497-511), add `extracted`:

```typescript
  return {
    usedModel: modelLabel,
    report,
    metrics: buildDaemonMetrics({ ... }),
    insights: buildInsightsForExtracted({ extracted, report, costUsd, summaryFromCache }),
    extracted,
  };
```

- [ ] **Step 3: Run all tests**

Run: `pnpm vitest run tests/server.summarize.test.ts`
Expected: PASS (existing tests use `as any` casts and aren't affected)

- [ ] **Step 4: Commit**

```bash
git add src/daemon/summarize.ts tests/server.summarize.test.ts
git commit -m "feat(history): expose extracted content from streamSummaryForUrl"
```

---

### Task 6: Add `HistoryStore` to route deps and record history

**Files:**

- Modify: `src/server/routes/summarize.ts:15-20, 138-234`
- Test: `tests/server.summarize.test.ts`

- [ ] **Step 1: Write failing test for history recording**

Append to `tests/server.summarize.test.ts`:

```typescript
import type { HistoryStore } from "../src/history.js";

describe("POST /v1/summarize – history recording", () => {
  it("records history entry on successful URL summarize", async () => {
    const insertedEntries: any[] = [];
    const fakeHistoryStore: Partial<HistoryStore> = {
      insert: (entry) => {
        insertedEntries.push(entry);
      },
    };

    const depsWithHistory = {
      ...fakeDeps,
      historyStore: fakeHistoryStore as HistoryStore,
      historyMediaPath: null,
      mediaCache: null,
    };

    vi.spyOn(summarizeMod, "streamSummaryForUrl").mockResolvedValueOnce({
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
        inputTokens: 100,
        outputTokens: 50,
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
        description: null,
        siteName: "example.com",
        truncated: false,
        totalCharacters: 600,
        wordCount: 100,
        transcriptCharacters: null,
        transcriptLines: null,
        transcriptWordCount: null,
        transcriptionProvider: null,
        transcriptMetadata: null,
        transcriptSegments: null,
        transcriptTimedText: null,
        mediaDurationSeconds: null,
        video: null,
        isVideoOnly: false,
        diagnostics: null,
      },
    } as any);

    const app = new Hono();
    const route = createSummarizeRoute(depsWithHistory as any);
    app.route("/v1", route);

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", length: "short" }),
    });

    expect(res.status).toBe(200);
    // Give fire-and-forget a tick to complete
    await new Promise((r) => setTimeout(r, 10));
    expect(insertedEntries).toHaveLength(1);
    expect(insertedEntries[0].sourceUrl).toBe("https://example.com");
    expect(insertedEntries[0].sourceType).toBe("article");
  });

  it("does NOT record history for extract-only requests", async () => {
    const insertedEntries: any[] = [];
    const fakeHistoryStore: Partial<HistoryStore> = {
      insert: (entry) => {
        insertedEntries.push(entry);
      },
    };

    const depsWithHistory = {
      ...fakeDeps,
      historyStore: fakeHistoryStore as HistoryStore,
      historyMediaPath: null,
    };

    vi.spyOn(summarizeMod, "extractContentForUrl").mockResolvedValueOnce({
      extracted: {
        url: "https://example.com",
        title: "Test",
        content: "body",
        transcriptSource: null,
      } as any,
      slides: null,
    });

    const app = new Hono();
    const route = createSummarizeRoute(depsWithHistory as any);
    app.route("/v1", route);

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", extract: true }),
    });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(insertedEntries).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.summarize.test.ts`
Expected: FAIL — `historyStore` not recognized / insert not called

- [ ] **Step 3: Add history recording to route handler**

In `src/server/routes/summarize.ts`:

Update `SummarizeRouteDeps` (line 15-20):

```typescript
export type SummarizeRouteDeps = {
  env: Record<string, string | undefined>;
  config: SummarizeConfig | null;
  cache: CacheState;
  mediaCache: MediaCache | null;
  historyStore?: HistoryStore | null;
  historyMediaPath?: string | null;
};
```

Add import at top:

```typescript
import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import type { HistoryStore } from "../../history.js";
```

Add a helper function before `createSummarizeRoute`:

```typescript
function detectSourceType(insights: SummarizeInsights | null, hasUrl: boolean): string {
  if (!hasUrl) return "text";
  if (!insights) return "article";
  const ts = insights.transcriptSource;
  if (ts && (ts.includes("youtube") || ts === "captionTracks" || ts === "yt-dlp")) return "video";
  if (insights.mediaDurationSeconds != null && insights.transcriptionProvider) return "podcast";
  return "article";
}
```

After the URL-mode `return c.json(response)` (line 182), insert history recording. Replace:

```typescript
return c.json(response);
```

with:

```typescript
// Record history (fire-and-forget)
if (deps.historyStore) {
  const historyId = randomUUID();
  const sourceType = detectSourceType(result.insights, true);
  const transcript = result.extracted.transcriptSource ? result.extracted.content : null;

  // Copy media before returning (avoid cache eviction race)
  let mediaPath: string | null = null;
  let mediaSize: number | null = null;
  let mediaType: string | null = null;
  if (deps.historyMediaPath && deps.mediaCache) {
    try {
      const mediaEntry = await deps.mediaCache.get({ url: body.url! });
      if (mediaEntry?.filePath) {
        const ext = extname(mediaEntry.filePath) || ".bin";
        const destName = `${historyId}${ext}`;
        await mkdir(deps.historyMediaPath, { recursive: true });
        await copyFile(mediaEntry.filePath, join(deps.historyMediaPath, destName));
        mediaPath = destName;
        mediaSize = mediaEntry.sizeBytes;
        mediaType = mediaEntry.mediaType;
      }
    } catch (err) {
      console.error("[summarize-api] history media copy failed:", err);
    }
  }

  void Promise.resolve().then(() => {
    try {
      deps.historyStore!.insert({
        id: historyId,
        createdAt: new Date().toISOString(),
        sourceUrl: body.url!,
        sourceType,
        inputLength: lengthRaw,
        model: result.usedModel,
        title: result.insights?.title ?? null,
        summary: chunks.join(""),
        transcript,
        mediaPath,
        mediaSize,
        mediaType,
        metadata: result.insights ? JSON.stringify(result.insights) : null,
      });
    } catch (err) {
      console.error("[summarize-api] history recording failed:", err);
    }
  });
}

return c.json(response);
```

Do the same for text mode (after line 234), with `sourceUrl: null` and `sourceType: "text"`, no media copy, and `transcript: null`.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/server.summarize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/summarize.ts tests/server.summarize.test.ts
git commit -m "feat(history): record history entries on successful summarization"
```

---

### Task 7: History API routes

**Files:**

- Create: `src/server/routes/history.ts`
- Test: `tests/server.history.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server.history.test.ts`:

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
    app.route("/v1", route);

    // Seed data
    store.insert({
      id: "entry-1",
      createdAt: "2026-03-12T10:00:00Z",
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
      metadata: JSON.stringify({ costUsd: 0.001 }),
    });
    store.insert({
      id: "entry-2",
      createdAt: "2026-03-12T11:00:00Z",
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/server.history.test.ts`
Expected: FAIL — `src/server/routes/history.js` does not exist

- [ ] **Step 3: Implement history routes**

Create `src/server/routes/history.ts`:

```typescript
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import type { HistoryStore } from "../../history.js";

export type HistoryRouteDeps = {
  historyStore: HistoryStore;
  historyMediaPath: string | null;
};

export function createHistoryRoute(deps: HistoryRouteDeps): Hono {
  const route = new Hono();

  // GET /history — paginated list
  route.get("/history", (c) => {
    const limitParam = parseInt(c.req.query("limit") ?? "20", 10);
    const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10));
    const limit = Math.min(Math.max(1, isNaN(limitParam) ? 20 : limitParam), 100);

    const { entries, total } = deps.historyStore.list({ limit, offset });

    return c.json({ entries, total, limit, offset });
  });

  // GET /history/:id — single entry with full detail
  route.get("/history/:id", (c) => {
    const entry = deps.historyStore.getById(c.req.param("id"));
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "History entry not found" } }, 404);
    }

    const hasMedia = entry.mediaPath != null && entry.mediaPath.length > 0;
    return c.json({
      ...entry,
      hasTranscript: entry.transcript != null && entry.transcript.length > 0,
      hasMedia,
      mediaUrl: hasMedia ? `/v1/history/${entry.id}/media` : null,
    });
  });

  // GET /history/:id/media — serve media file
  route.get("/history/:id/media", (c) => {
    const entry = deps.historyStore.getById(c.req.param("id"));
    if (!entry?.mediaPath || !deps.historyMediaPath) {
      return c.json({ error: { code: "NOT_FOUND", message: "Media not found" } }, 404);
    }

    const filePath = join(deps.historyMediaPath, entry.mediaPath);
    if (!existsSync(filePath)) {
      return c.json({ error: { code: "NOT_FOUND", message: "Media file not found on disk" } }, 404);
    }

    const contentType = entry.mediaType ?? "application/octet-stream";
    const stream = createReadStream(filePath);
    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": contentType,
        ...(entry.mediaSize != null ? { "Content-Length": String(entry.mediaSize) } : {}),
      },
    });
  });

  // DELETE /history/:id — delete entry + media
  route.delete("/history/:id", async (c) => {
    const entry = deps.historyStore.getById(c.req.param("id"));
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "History entry not found" } }, 404);
    }

    // Delete media file if present
    if (entry.mediaPath && deps.historyMediaPath) {
      const filePath = join(deps.historyMediaPath, entry.mediaPath);
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(filePath);
      } catch {
        // File may already be gone — that's fine
      }
    }

    deps.historyStore.deleteById(c.req.param("id"));
    return new Response(null, { status: 204 });
  });

  return route;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/server.history.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/history.ts tests/server.history.test.ts
git commit -m "feat(history): add history API routes (list, detail, media, delete)"
```

---

### Task 8: Wire history into server bootstrap

**Files:**

- Modify: `src/server/index.ts`
- Modify: `src/server/main.ts`

- [ ] **Step 1: Update `src/server/index.ts`**

Add imports and wire routes:

```typescript
import { createHistoryRoute, type HistoryRouteDeps } from "./routes/history.js";
import type { HistoryStore } from "../history.js";
```

Note: `ServerDeps` extends `SummarizeRouteDeps`, so `historyStore` and `historyMediaPath` are inherited automatically — no changes to `ServerDeps` needed.

After the summarize route block (after line 35), add:

```typescript
// History routes (protected)
if (deps.historyStore) {
  const historyRoute = createHistoryRoute({
    historyStore: deps.historyStore,
    historyMediaPath: deps.historyMediaPath ?? null,
  });
  app.use("/v1/history/*", authMiddleware(deps.apiToken));
  app.use("/v1/history", authMiddleware(deps.apiToken));
  app.route("/v1", historyRoute);
}
```

- [ ] **Step 2: Update `src/server/main.ts`**

Add import:

```typescript
import {
  createHistoryStateFromConfig,
  resolveHistoryMediaPathFromConfig,
} from "../run/history-state.js";
```

After the `mediaCache` line (line 18), add:

```typescript
const historyStore = await createHistoryStateFromConfig({ envForRun: env, config });
const historyMediaPath = resolveHistoryMediaPathFromConfig({ envForRun: env, config });
```

Update the `createApp` call:

```typescript
const app = createApp({ env, config, cache, mediaCache, apiToken, historyStore, historyMediaPath });
```

Add cleanup on shutdown (inside the signal handler, before `server.close`):

```typescript
historyStore?.close();
```

- [ ] **Step 3: Run all server tests**

Run: `pnpm vitest run tests/server.*.test.ts`
Expected: PASS

- [ ] **Step 4: Build and verify**

Run: `pnpm build`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts src/server/main.ts
git commit -m "feat(history): wire history store and routes into server bootstrap"
```

---

## Chunk 3: Web Frontend

### Task 9: Add History tab and list view to web UI

**Files:**

- Modify: `src/server/public/index.html`

- [ ] **Step 1: Add History tab button**

In `index.html`, add a History tab after the Text tab (line 378):

```html
<button type="button" class="tab" data-tab="history">History</button>
```

- [ ] **Step 2: Add History tab content**

After the `tab-text` div (after line 392), add:

```html
<div id="tab-history" class="tab-content">
  <div id="history-list"></div>
  <div id="history-detail" style="display: none"></div>
  <button
    type="button"
    id="history-load-more"
    style="display: none; margin-top: 1rem; padding: 0.5rem 1rem; font-size: 0.875rem; font-family: inherit; background: #fff; border: 1px solid #d0d0d0; border-radius: 6px; cursor: pointer; width: 100%;"
  >
    Load more
  </button>
  <div
    id="history-empty"
    style="display: none; color: #999; text-align: center; padding: 2rem 0; font-size: 0.9375rem;"
  >
    No history yet. Summarize something first!
  </div>
</div>
```

- [ ] **Step 3: Add CSS for history view**

Before the closing `</style>` tag (before line 365), add:

```css
/* History */
.history-item {
  padding: 0.75rem 1rem;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  margin-bottom: 0.5rem;
  cursor: pointer;
  background: #fff;
  transition: border-color 0.15s;
}

.history-item:hover {
  border-color: #999;
}

.history-item-title {
  font-weight: 500;
  font-size: 0.9375rem;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-meta {
  font-size: 0.8rem;
  color: #999;
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.history-badge {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  font-size: 0.7rem;
  font-weight: 500;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.badge-article {
  background: #e8f4fd;
  color: #1a6fb5;
}
.badge-video {
  background: #fce8e8;
  color: #b51a1a;
}
.badge-podcast {
  background: #e8fce8;
  color: #1a7a1a;
}
.badge-text {
  background: #f0f0f0;
  color: #666;
}

.history-detail-back {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
  color: #666;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem 0;
  margin-bottom: 1rem;
  font-family: inherit;
}

.history-detail-back:hover {
  color: #1a1a1a;
}

.history-transcript-toggle {
  margin-top: 1rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  font-family: inherit;
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  cursor: pointer;
  width: 100%;
  text-align: left;
}

.history-transcript-body {
  display: none;
  margin-top: 0.5rem;
  padding: 1rem;
  background: #fafafa;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  font-size: 0.875rem;
  line-height: 1.6;
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
}

.history-delete-btn {
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-family: inherit;
  color: #991b1b;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  border-radius: 6px;
  cursor: pointer;
}

.history-delete-btn:hover {
  background: #fee2e2;
}
```

- [ ] **Step 4: Add JavaScript for history functionality**

Before the closing `})();` (before line 648), add the history JavaScript. This is a substantial block — add it after the `formatDuration` function:

```javascript
// ---- History ----
var historyOffset = 0;
var historyLimit = 20;
var historyTotal = 0;

var historyList = document.getElementById("history-list");
var historyDetail = document.getElementById("history-detail");
var historyLoadMore = document.getElementById("history-load-more");
var historyEmpty = document.getElementById("history-empty");

function badgeClass(type) {
  return "history-badge badge-" + (type || "article");
}

function formatDate(iso) {
  try {
    var d = new Date(iso);
    return (
      d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return iso;
  }
}

function truncateUrl(url, max) {
  if (!url || url.length <= max) return url;
  return url.substring(0, max) + "…";
}

async function loadHistory(append) {
  if (!append) {
    historyOffset = 0;
    historyList.innerHTML = "";
  }
  try {
    var res = await fetch("/v1/history?limit=" + historyLimit + "&offset=" + historyOffset, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) return;
    var data = await res.json();
    historyTotal = data.total;

    if (data.entries.length === 0 && historyOffset === 0) {
      historyEmpty.style.display = "block";
      historyLoadMore.style.display = "none";
      return;
    }
    historyEmpty.style.display = "none";

    data.entries.forEach(function (entry) {
      var div = document.createElement("div");
      div.className = "history-item";
      div.setAttribute("data-id", entry.id);
      var title = entry.title || truncateUrl(entry.sourceUrl, 60) || "Text input";
      div.innerHTML =
        '<div class="history-item-title">' +
        escapeHtml(title) +
        "</div>" +
        '<div class="history-item-meta">' +
        '<span class="' +
        badgeClass(entry.sourceType) +
        '">' +
        escapeHtml(entry.sourceType || "article") +
        "</span>" +
        "<span>" +
        escapeHtml(formatDate(entry.createdAt)) +
        "</span>" +
        "<span>" +
        escapeHtml(entry.model) +
        "</span>" +
        "</div>";
      div.addEventListener("click", function () {
        showHistoryDetail(entry.id);
      });
      historyList.appendChild(div);
    });

    historyOffset += data.entries.length;
    historyLoadMore.style.display = historyOffset < historyTotal ? "block" : "none";
  } catch (err) {
    console.error("Failed to load history:", err);
  }
}

async function showHistoryDetail(id) {
  try {
    var res = await fetch("/v1/history/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) return;
    var entry = await res.json();

    historyList.style.display = "none";
    historyLoadMore.style.display = "none";
    historyDetail.style.display = "block";

    var html = '<button class="history-detail-back" id="history-back">\u2190 Back to list</button>';
    html +=
      '<div class="result-body">' +
      DOMPurify.sanitize(marked.parse(entry.summary || "")) +
      "</div>";

    // Metadata
    var metaParts = [];
    if (entry.sourceUrl)
      metaParts.push(
        '<a href="' +
          escapeHtml(entry.sourceUrl) +
          '" target="_blank" rel="noopener">' +
          escapeHtml(truncateUrl(entry.sourceUrl, 50)) +
          "</a>",
      );
    metaParts.push(escapeHtml(entry.model));
    metaParts.push(escapeHtml(entry.inputLength));
    metaParts.push(escapeHtml(formatDate(entry.createdAt)));
    if (entry.metadata) {
      try {
        var meta = typeof entry.metadata === "string" ? JSON.parse(entry.metadata) : entry.metadata;
        if (meta.costUsd != null) metaParts.push("Cost: $" + meta.costUsd.toFixed(4));
        if (meta.inputTokens != null || meta.outputTokens != null) {
          metaParts.push(
            "Tokens: " + ((meta.inputTokens || 0) + (meta.outputTokens || 0)).toLocaleString(),
          );
        }
      } catch {}
    }
    html +=
      '<div class="result-meta">' +
      metaParts
        .map(function (p) {
          return "<span>" + p + "</span>";
        })
        .join("") +
      "</div>";

    // Media player
    if (entry.hasMedia && entry.mediaUrl) {
      var mtype = entry.mediaType || "";
      if (mtype.startsWith("video/")) {
        html +=
          '<video controls style="width:100%;margin-top:1rem;border-radius:6px;" src="' +
          escapeHtml(entry.mediaUrl) +
          "?token=" +
          encodeURIComponent(token) +
          '"></video>';
      } else {
        html +=
          '<audio controls style="width:100%;margin-top:1rem;" src="' +
          escapeHtml(entry.mediaUrl) +
          "?token=" +
          encodeURIComponent(token) +
          '"></audio>';
      }
    }

    // Transcript
    if (entry.hasTranscript && entry.transcript) {
      html +=
        '<button class="history-transcript-toggle" id="transcript-toggle">Show transcript</button>';
      html +=
        '<div class="history-transcript-body" id="transcript-body">' +
        escapeHtml(entry.transcript) +
        "</div>";
    }

    // Delete
    html += '<button class="history-delete-btn" id="history-delete-btn">Delete this entry</button>';

    historyDetail.innerHTML = html;

    document.getElementById("history-back").addEventListener("click", function () {
      historyDetail.style.display = "none";
      historyList.style.display = "block";
      if (historyOffset < historyTotal) historyLoadMore.style.display = "block";
    });

    var toggleBtn = document.getElementById("transcript-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        var body = document.getElementById("transcript-body");
        var visible = body.style.display === "block";
        body.style.display = visible ? "none" : "block";
        toggleBtn.textContent = visible ? "Show transcript" : "Hide transcript";
      });
    }

    document.getElementById("history-delete-btn").addEventListener("click", async function () {
      if (!confirm("Delete this history entry? This cannot be undone.")) return;
      try {
        await fetch("/v1/history/" + encodeURIComponent(id), {
          method: "DELETE",
          headers: { Authorization: "Bearer " + token },
        });
        historyDetail.style.display = "none";
        historyList.style.display = "block";
        loadHistory(false);
      } catch (err) {
        alert("Delete failed: " + err.message);
      }
    });
  } catch (err) {
    console.error("Failed to load history detail:", err);
  }
}

historyLoadMore.addEventListener("click", function () {
  loadHistory(true);
});

// Load history when History tab is clicked
document.querySelectorAll(".tab").forEach(function (tab) {
  tab.addEventListener("click", function () {
    var target = this.getAttribute("data-tab");
    if (target === "history") {
      historyDetail.style.display = "none";
      historyList.style.display = "block";
      loadHistory(false);
    }
  });
});
```

- [ ] **Step 5: Also hide form-row and submit when History tab is active**

Update the existing tab switching logic. In the tab click handler (around line 448-462), add form visibility toggling. After `c.classList.toggle(...)`:

```javascript
// Hide form controls on history tab
var formRow = document.querySelector(".form-row");
if (formRow) formRow.style.display = target === "history" ? "none" : "flex";
```

- [ ] **Step 6: Build and manually test**

Run: `pnpm build`
Then start the server and verify in browser.

- [ ] **Step 7: Commit**

```bash
git add src/server/public/index.html
git commit -m "feat(history): add history tab and UI to web frontend"
```

---

## Chunk 4: Integration & Polish

### Task 10: Run full test suite

- [ ] **Step 1: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 2: Run build**

Run: `pnpm build`
Expected: Clean build with no errors

- [ ] **Step 3: Run check**

Run: `pnpm check`
Expected: No lint/type errors

---

### Task 11: Update documentation

**Files:**

- Modify: `docs/api-server.md`

- [ ] **Step 1: Add history endpoints to API docs**

Add a "History" section to `docs/api-server.md` documenting:

- `GET /v1/history` — paginated list (query params: `limit`, `offset`)
- `GET /v1/history/:id` — full entry detail
- `GET /v1/history/:id/media` — media file download
- `DELETE /v1/history/:id` — delete entry

- [ ] **Step 2: Add history config to `docs/config.md`**

Document the `history` config section:

```json
{
  "history": {
    "enabled": true,
    "path": "~/.summarize/history.sqlite",
    "mediaPath": "~/.summarize/history/media/"
  }
}
```

And the `SUMMARIZE_HISTORY_ENABLED` env var.

- [ ] **Step 3: Commit**

```bash
git add docs/api-server.md docs/config.md
git commit -m "docs: add history API and config documentation"
```

---

### Task 12: Auth for media endpoint (token via query param)

**Files:**

- Modify: `src/server/middleware/auth.ts`
- Test: `tests/server.auth.test.ts`

The web UI passes the token as a query param for `<audio>`/`<video>` `src` attributes (browsers don't send custom headers for media elements). The auth middleware needs to also check `?token=` as a fallback.

- [ ] **Step 1: Write failing test**

Append to `tests/server.auth.test.ts`:

```typescript
it("accepts token via query param when no Authorization header", async () => {
  const app = new Hono();
  app.use("/v1/history/*", authMiddleware("secret-token"));
  app.get("/v1/history/:id/media", (c) => c.text("ok"));

  const res = await app.request("/v1/history/123/media?token=secret-token");
  expect(res.status).toBe(200);
});

it("rejects invalid query param token", async () => {
  const app = new Hono();
  app.use("/v1/history/*", authMiddleware("secret-token"));
  app.get("/v1/history/:id/media", (c) => c.text("ok"));

  const res = await app.request("/v1/history/123/media?token=wrong");
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.auth.test.ts`
Expected: FAIL — query param token not accepted

- [ ] **Step 3: Update auth middleware (preserve existing behavior, add query param fallback)**

In `src/server/middleware/auth.ts`, change only the token extraction logic to also check `c.req.query("token")`. Keep `safeCompare`/`timingSafeEqual` and the existing `null`-token-returns-500 behavior:

```typescript
export function authMiddleware(token: string | null) {
  return createMiddleware(async (c, next) => {
    if (!token) {
      console.warn("[summarize-api] auth: API token not configured on server");
      return c.json({ error: { code: "SERVER_ERROR", message: "API token not configured" } }, 500);
    }
    const header = c.req.header("Authorization");
    const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    // Fall back to query param for <audio>/<video> src attributes
    const queryToken = c.req.query("token")?.trim();
    const candidate = bearer || queryToken || "";
    if (!candidate || !safeCompare(candidate, token)) {
      console.warn(
        `[summarize-api] auth: rejected ${c.req.method} ${c.req.path} — ${candidate ? "invalid token" : "missing token"}`,
      );
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid or missing bearer token" } },
        401,
      );
    }
    await next();
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/server.auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/auth.ts tests/server.auth.test.ts
git commit -m "feat(history): support token query param for media streaming auth"
```
