# Multi-Account Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-account history isolation so multiple friends can use the same server without seeing each other's summaries.

**Architecture:** Config-file-based accounts with unique tokens. Auth middleware resolves token → account name, sets it on Hono context. All history queries scoped by account. No migration — old table dropped and recreated.

**Tech Stack:** TypeScript, Hono (web framework), better-sqlite3, vitest

**Spec:** `docs/superpowers/specs/2026-03-12-multi-account-design.md`

---

## File Map

| Action | File                             | Responsibility                                                    |
| ------ | -------------------------------- | ----------------------------------------------------------------- |
| Modify | `src/config/types.ts`            | Add `Account` type, `accounts` to `SummarizeConfig`               |
| Create | `src/config/accounts.ts`         | `parseAccountsConfig()` validation                                |
| Modify | `src/config.ts`                  | Wire accounts parsing into `loadSummarizeConfig`                  |
| Modify | `src/server/middleware/auth.ts`  | Token → account lookup, set on context                            |
| Modify | `src/history.ts`                 | Add `account` column, scope all queries                           |
| Modify | `src/server/index.ts`            | Update `ServerDeps`, wire accounts, add `/v1/me` route            |
| Create | `src/server/routes/me.ts`        | `GET /v1/me` endpoint                                             |
| Modify | `src/server/routes/history.ts`   | Thread account from context into store calls                      |
| Modify | `src/server/routes/summarize.ts` | Thread account into history insert                                |
| Modify | `src/server/main.ts`             | Replace single token with accounts, validate, deprecation warning |
| Modify | `src/run/history-state.ts`       | Pass through (no changes needed, store creation unchanged)        |
| Modify | `src/server/public/index.html`   | Call `/v1/me`, display greeting                                   |
| Modify | `tests/server.auth.test.ts`      | Update to accounts-based auth                                     |
| Modify | `tests/server.history.test.ts`   | Add account scoping + cross-account isolation                     |
| Modify | `tests/history.test.ts`          | Add account to all insert calls                                   |
| Create | `tests/server.me.test.ts`        | Test `/v1/me` endpoint                                            |
| Create | `tests/config.accounts.test.ts`  | Test accounts config validation                                   |

---

## Chunk 1: Config + Account Type

### Task 1: Account type and config schema

**Files:**

- Modify: `src/config/types.ts`

- [ ] **Step 1: Add Account type and accounts field to SummarizeConfig**

In `src/config/types.ts`, add before the `SummarizeConfig` type:

```typescript
export type Account = {
  name: string;
  token: string;
};
```

And add to `SummarizeConfig`:

```typescript
  accounts?: Account[];
```

Place it as the first field in `SummarizeConfig` (before `model`).

- [ ] **Step 2: Verify build**

Run: `pnpm -s build`
Expected: SUCCESS (no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/config/types.ts
git commit -m "feat(accounts): add Account type and accounts field to SummarizeConfig"
```

---

### Task 2: Accounts config validation

**Files:**

- Create: `src/config/accounts.ts`
- Create: `tests/config.accounts.test.ts`

- [ ] **Step 1: Write failing tests for accounts validation**

Create `tests/config.accounts.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseAccountsConfig } from "../src/config/accounts.js";

describe("parseAccountsConfig", () => {
  const path = "/fake/config.json";

  it("returns undefined when accounts key is missing", () => {
    expect(parseAccountsConfig(undefined, path)).toBeUndefined();
  });

  it("throws if accounts is not an array", () => {
    expect(() => parseAccountsConfig("bad", path)).toThrow("must be an array");
  });

  it("throws if accounts is empty", () => {
    expect(() => parseAccountsConfig([], path)).toThrow("at least one account");
  });

  it("throws if name is missing", () => {
    expect(() => parseAccountsConfig([{ token: "a".repeat(32) }], path)).toThrow("name");
  });

  it("throws if token is missing", () => {
    expect(() => parseAccountsConfig([{ name: "alice" }], path)).toThrow("token");
  });

  it("throws if name has invalid characters", () => {
    expect(() => parseAccountsConfig([{ name: "Alice!", token: "a".repeat(32) }], path)).toThrow(
      "lowercase",
    );
  });

  it("throws if token is too short", () => {
    expect(() => parseAccountsConfig([{ name: "alice", token: "short" }], path)).toThrow(
      "32 characters",
    );
  });

  it("throws on duplicate names", () => {
    expect(() =>
      parseAccountsConfig(
        [
          { name: "alice", token: "a".repeat(32) },
          { name: "alice", token: "b".repeat(32) },
        ],
        path,
      ),
    ).toThrow("Duplicate account name");
  });

  it("throws on duplicate tokens", () => {
    const tok = "a".repeat(32);
    expect(() =>
      parseAccountsConfig(
        [
          { name: "alice", token: tok },
          { name: "bob", token: tok },
        ],
        path,
      ),
    ).toThrow("Duplicate token");
  });

  it("parses valid accounts", () => {
    const result = parseAccountsConfig(
      [
        { name: "alice", token: "a".repeat(32) },
        { name: "bob-2", token: "b".repeat(32) },
      ],
      path,
    );
    expect(result).toEqual([
      { name: "alice", token: "a".repeat(32) },
      { name: "bob-2", token: "b".repeat(32) },
    ]);
  });

  it("accepts hyphens in names", () => {
    const result = parseAccountsConfig([{ name: "my-friend-1", token: "x".repeat(32) }], path);
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe("my-friend-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/config.accounts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement parseAccountsConfig**

Create `src/config/accounts.ts`:

```typescript
import type { Account } from "./types.js";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MIN_TOKEN_LENGTH = 32;

export function parseAccountsConfig(raw: unknown, configPath: string): Account[] | undefined {
  if (raw === undefined) return undefined;

  if (!Array.isArray(raw)) {
    throw new Error(`Invalid config file ${configPath}: "accounts" must be an array`);
  }

  if (raw.length === 0) {
    throw new Error(
      `Invalid config file ${configPath}: "accounts" must contain at least one account`,
    );
  }

  const names = new Set<string>();
  const tokens = new Set<string>();
  const accounts: Account[] = [];

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    const prefix = `Invalid config file ${configPath}: accounts[${i}]`;

    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${prefix} must be an object`);
    }

    const record = entry as Record<string, unknown>;
    const name = record.name;
    const token = record.token;

    if (typeof name !== "string" || !name.trim()) {
      throw new Error(`${prefix}: "name" is required and must be a non-empty string`);
    }

    if (typeof token !== "string" || !token.trim()) {
      throw new Error(`${prefix}: "token" is required and must be a non-empty string`);
    }

    const trimmedName = name.trim();
    const trimmedToken = token.trim();

    if (!NAME_PATTERN.test(trimmedName)) {
      throw new Error(
        `${prefix}: "name" must be lowercase alphanumeric with hyphens (got "${trimmedName}")`,
      );
    }

    if (trimmedToken.length < MIN_TOKEN_LENGTH) {
      throw new Error(
        `${prefix}: "token" must be at least ${MIN_TOKEN_LENGTH} characters (got ${trimmedToken.length})`,
      );
    }

    if (names.has(trimmedName)) {
      throw new Error(`Invalid config file ${configPath}: Duplicate account name "${trimmedName}"`);
    }

    if (tokens.has(trimmedToken)) {
      throw new Error(
        `Invalid config file ${configPath}: Duplicate token found for account "${trimmedName}"`,
      );
    }

    names.add(trimmedName);
    tokens.add(trimmedToken);
    accounts.push({ name: trimmedName, token: trimmedToken });
  }

  return accounts;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/config.accounts.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/accounts.ts tests/config.accounts.test.ts
git commit -m "feat(accounts): add parseAccountsConfig validation"
```

---

### Task 3: Wire accounts into config loader

**Files:**

- Modify: `src/config.ts`

- [ ] **Step 1: Add accounts parsing to loadSummarizeConfig**

In `src/config.ts`:

Add import at top:

```typescript
import { parseAccountsConfig } from "./config/accounts.js";
```

Add re-export:

```typescript
export type { Account } from "./config/types.js";
```

Inside `loadSummarizeConfig`, after line `const apiKeys = parseApiKeysConfig(parsed, path);`, add:

```typescript
const accounts = parseAccountsConfig(parsed.accounts, path);
```

Note: `parsed` is already narrowed to `Record<string, unknown>` after the null check, and `path` is non-null after the early return on line 51. No casts needed.

In the return object, add alongside other fields:

```typescript
      ...(accounts ? { accounts } : {}),
```

- [ ] **Step 2: Verify build**

Run: `pnpm -s build`
Expected: SUCCESS

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat(accounts): wire accounts parsing into config loader"
```

---

## Chunk 2: Auth Middleware

### Task 4: Rewrite auth middleware for multi-account

**Files:**

- Modify: `src/server/middleware/auth.ts`
- Modify: `tests/server.auth.test.ts`

- [ ] **Step 1: Write updated auth tests**

Rewrite `tests/server.auth.test.ts`:

```typescript
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { authMiddleware } from "../src/server/middleware/auth.js";
import type { Account } from "../src/config/types.js";

const TEST_ACCOUNTS: Account[] = [
  { name: "alice", token: "a".repeat(32) },
  { name: "bob", token: "b".repeat(32) },
];

function createTestApp(accounts: Account[]) {
  const app = new Hono();
  app.use("*", authMiddleware(accounts));
  app.get("/test", (c) => c.json({ ok: true, account: c.get("account") }));
  return app;
}

describe("auth middleware (multi-account)", () => {
  it("rejects when no accounts configured", async () => {
    const app = createTestApp([]);
    const res = await app.request("/test");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_ERROR");
  });

  it("rejects missing Authorization header", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("rejects wrong token", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts alice's token and sets account", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${"a".repeat(32)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account).toBe("alice");
  });

  it("accepts bob's token and sets account", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${"b".repeat(32)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account).toBe("bob");
  });

  it("accepts token via query param", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request(`/test?token=${"a".repeat(32)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account).toBe("alice");
  });

  it("rejects invalid query param token", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request("/test?token=wrong");
    expect(res.status).toBe(401);
  });

  it("prefers Authorization header over query param", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request(`/test?token=${"b".repeat(32)}`, {
      headers: { Authorization: `Bearer ${"a".repeat(32)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account).toBe("alice");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/server.auth.test.ts`
Expected: FAIL — signature mismatch, `c.get("account")` not set

- [ ] **Step 3: Rewrite auth middleware**

Replace `src/server/middleware/auth.ts`:

```typescript
import { createMiddleware } from "hono/factory";
import type { Account } from "../../config/types.js";

export function authMiddleware(accounts: Account[]) {
  // Map lookup (not timing-safe) is acceptable for friend-sharing scope.
  // For public-facing auth with high-value tokens, consider constant-time comparison.
  const tokenMap = new Map<string, string>();
  for (const account of accounts) {
    tokenMap.set(account.token, account.name);
  }

  return createMiddleware(async (c, next) => {
    if (tokenMap.size === 0) {
      console.warn("[summarize-api] auth: no accounts configured on server");
      return c.json({ error: { code: "SERVER_ERROR", message: "No accounts configured" } }, 500);
    }

    const header = c.req.header("Authorization");
    const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    // Fall back to query param for <audio>/<video> src attributes
    const queryToken = c.req.query("token")?.trim();
    const candidate = bearer || queryToken || "";

    const accountName = candidate ? tokenMap.get(candidate) : undefined;
    if (!accountName) {
      console.warn(
        `[summarize-api] auth: rejected ${c.req.method} ${c.req.path} — ${candidate ? "invalid token" : "missing token"}`,
      );
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid or missing bearer token" } },
        401,
      );
    }

    c.set("account", accountName);
    await next();
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/server.auth.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/auth.ts tests/server.auth.test.ts
git commit -m "feat(accounts): rewrite auth middleware for multi-account token lookup"
```

---

## Chunk 3: History Store

### Task 5: Add account column to history store

**Files:**

- Modify: `src/history.ts`
- Modify: `tests/history.test.ts`

- [ ] **Step 1: Update history tests to include account**

In `tests/history.test.ts`, update the `HistoryEntry` type usage. Every `store.insert()` call needs `account: "test-user"`. Every `store.getById()` and `store.deleteById()` call needs a second `account` argument. Every `store.list()` call needs `account` as first arg.

Add a cross-account isolation test:

```typescript
it("isolates entries by account", () => {
  store.insert({
    id: "alice-entry",
    createdAt: new Date().toISOString(),
    account: "alice",
    sourceUrl: "https://example.com/alice",
    sourceType: "article",
    inputLength: "short",
    model: "test-model",
    title: "Alice's Article",
    summary: "Alice's summary",
    transcript: null,
    mediaPath: null,
    mediaSize: null,
    mediaType: null,
    metadata: null,
  });
  store.insert({
    id: "bob-entry",
    createdAt: new Date().toISOString(),
    account: "bob",
    sourceUrl: "https://example.com/bob",
    sourceType: "article",
    inputLength: "short",
    model: "test-model",
    title: "Bob's Article",
    summary: "Bob's summary",
    transcript: null,
    mediaPath: null,
    mediaSize: null,
    mediaType: null,
    metadata: null,
  });

  // Alice sees only her entry
  const aliceList = store.list({ account: "alice", limit: 10, offset: 0 });
  expect(aliceList.total).toBe(1);
  expect(aliceList.entries[0].id).toBe("alice-entry");

  // Bob sees only his entry
  const bobList = store.list({ account: "bob", limit: 10, offset: 0 });
  expect(bobList.total).toBe(1);
  expect(bobList.entries[0].id).toBe("bob-entry");

  // Alice can't get Bob's entry by ID
  expect(store.getById("bob-entry", "alice")).toBeNull();

  // Alice can't delete Bob's entry
  expect(store.deleteById("bob-entry", "alice")).toBe(false);

  // Bob's entry still exists
  expect(store.getById("bob-entry", "bob")).not.toBeNull();
});
```

Update all existing test entries to include `account: "test-user"`.

Update all existing calls:

- `store.getById(id)` → `store.getById(id, "test-user")`
- `store.deleteById(id)` → `store.deleteById(id, "test-user")`
- `store.list({ limit, offset })` → `store.list({ account: "test-user", limit, offset })`

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/history.test.ts`
Expected: FAIL — signature mismatches

- [ ] **Step 3: Update history store implementation**

In `src/history.ts`:

Add `account: string` to `HistoryEntry`:

```typescript
export type HistoryEntry = {
  id: string;
  createdAt: string;
  account: string;
  sourceUrl: string | null;
  // ...rest unchanged
};
```

Update `HistoryStore` type signatures:

```typescript
export type HistoryStore = {
  insert: (entry: HistoryEntry) => void;
  getById: (id: string, account: string) => HistoryEntry | null;
  list: (opts: { account: string; limit: number; offset: number }) => {
    entries: HistoryListItem[];
    total: number;
  };
  deleteById: (id: string, account: string) => boolean;
  close: () => void;
};
```

In `createHistoryStore`:

Update table creation — add `account TEXT NOT NULL` column after `created_at`. But first, check if existing table lacks the column, and if so, drop it:

```typescript
// Check if existing table needs migration (lacks account column)
const tableInfo = db.prepare("PRAGMA table_info(history)").all() as Array<{ name: string }>;
const hasTable = tableInfo.length > 0;
const hasAccountCol = tableInfo.some((col) => col.name === "account");
if (hasTable && !hasAccountCol) {
  console.warn(
    "[summarize-api] history: dropping legacy history table (no account column) — starting fresh",
  );
  db.exec("DROP TABLE history");
  db.exec("DROP INDEX IF EXISTS idx_history_created");
}
```

Then the CREATE TABLE:

```sql
  CREATE TABLE IF NOT EXISTS history (
    id            TEXT PRIMARY KEY,
    created_at    TEXT NOT NULL,
    account       TEXT NOT NULL,
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
```

Drop old index (unconditionally) and create new one:

```typescript
db.exec("DROP INDEX IF EXISTS idx_history_created");
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_history_account_created ON history(account, created_at DESC)",
);
```

Update prepared statements:

```typescript
const stmtInsert = db.prepare(`
    INSERT INTO history (
      id, created_at, account, source_url, source_type, input_length, model,
      title, summary, transcript, media_path, media_size, media_type, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

const stmtGetById = db.prepare("SELECT * FROM history WHERE id = ? AND account = ?");
const stmtList = db.prepare(
  "SELECT * FROM history WHERE account = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
);
const stmtCount = db.prepare("SELECT COUNT(*) AS total FROM history WHERE account = ?");
const stmtDelete = db.prepare("DELETE FROM history WHERE id = ? AND account = ?");
```

Update `mapRow` to include `account`:

```typescript
const mapRow = (row: Record<string, unknown>): HistoryEntry => ({
  id: row.id as string,
  createdAt: row.created_at as string,
  account: row.account as string,
  // ...rest unchanged
});
```

Update `insert`:

```typescript
const insert = (entry: HistoryEntry): void => {
  stmtInsert.run(
    entry.id,
    entry.createdAt,
    entry.account,
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
```

Update `getById`:

```typescript
const getById = (id: string, account: string): HistoryEntry | null => {
  const row = stmtGetById.get(id, account) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRow(row);
};
```

Update `list`:

```typescript
const list = (opts: {
  account: string;
  limit: number;
  offset: number;
}): { entries: HistoryListItem[]; total: number } => {
  const countRow = stmtCount.get(opts.account) as { total?: number } | undefined;
  const total = typeof countRow?.total === "number" ? countRow.total : 0;
  const rows = stmtList.all(opts.account, opts.limit, opts.offset) as Array<
    Record<string, unknown>
  >;
  // ...rest unchanged
};
```

Update `deleteById`:

```typescript
const deleteById = (id: string, account: string): boolean => {
  const result = stmtDelete.run(id, account) as { changes?: number };
  return typeof result?.changes === "number" ? result.changes > 0 : false;
};
```

- [ ] **Step 4: Run history tests to verify they pass**

Run: `pnpm vitest run tests/history.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/history.ts tests/history.test.ts
git commit -m "feat(accounts): add account column to history store with per-account isolation"
```

---

## Chunk 4: Routes + Server Wiring

### Task 6: Add /v1/me route

**Files:**

- Create: `src/server/routes/me.ts`
- Create: `tests/server.me.test.ts`

- [ ] **Step 1: Write test for /v1/me**

Create `tests/server.me.test.ts`:

```typescript
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createMeRoute } from "../src/server/routes/me.js";

function createTestApp(accountName: string) {
  const app = new Hono();
  // Simulate auth middleware setting account
  app.use("*", async (c, next) => {
    c.set("account", accountName);
    await next();
  });
  app.route("/v1", createMeRoute());
  return app;
}

describe("GET /v1/me", () => {
  it("returns account name", async () => {
    const app = createTestApp("alice");
    const res = await app.request("/v1/me");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ account: { name: "alice" } });
  });

  it("returns correct name for different account", async () => {
    const app = createTestApp("bob");
    const res = await app.request("/v1/me");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.name).toBe("bob");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.me.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement /v1/me route**

Create `src/server/routes/me.ts`:

```typescript
import { Hono } from "hono";

export function createMeRoute(): Hono {
  const route = new Hono();

  route.get("/me", (c) => {
    const account = c.get("account") as string;
    return c.json({ account: { name: account } });
  });

  return route;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/server.me.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/me.ts tests/server.me.test.ts
git commit -m "feat(accounts): add GET /v1/me endpoint"
```

---

### Task 7: Update history routes to use account context

**Files:**

- Modify: `src/server/routes/history.ts`
- Modify: `tests/server.history.test.ts`

- [ ] **Step 1: Update history route tests**

In `tests/server.history.test.ts`:

Update `beforeEach` — all seeded entries get `account: "test-user"`, and add an auth-simulating middleware:

```typescript
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
    // ...rest unchanged
  });
  store.insert({
    id: "entry-2",
    createdAt: "2026-03-12T11:00:00Z",
    account: "test-user",
    // ...rest unchanged
  });
});
```

Add a cross-account isolation test:

```typescript
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
    metadata: null,
  });

  const res = await app.request("/v1/history/other-entry", { method: "DELETE" });
  expect(res.status).toBe(404);
});

it("GET /v1/history/:id/media returns 404 for other account's media", async () => {
  // Create media file for other-user
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
    metadata: null,
  });

  const res = await app.request("/v1/history/other-media-entry/media");
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/server.history.test.ts`
Expected: FAIL — store method signatures don't match route code

- [ ] **Step 3: Update history route to thread account**

In `src/server/routes/history.ts`, update every handler to read account from context and pass it to store methods:

```typescript
route.get("/history", (c) => {
  const account = c.get("account") as string;
  // ...existing limit/offset parsing...
  const { entries, total } = deps.historyStore.list({ account, limit, offset });
  return c.json({ entries, total, limit, offset });
});

route.get("/history/:id", (c) => {
  const account = c.get("account") as string;
  const entry = deps.historyStore.getById(c.req.param("id"), account);
  // ...rest unchanged
});

route.get("/history/:id/media", (c) => {
  const account = c.get("account") as string;
  const entry = deps.historyStore.getById(c.req.param("id"), account);
  // ...rest unchanged
});

route.delete("/history/:id", async (c) => {
  const account = c.get("account") as string;
  const entry = deps.historyStore.getById(c.req.param("id"), account);
  // ...existing media deletion logic...
  deps.historyStore.deleteById(c.req.param("id"), account);
  return new Response(null, { status: 204 });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/server.history.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/history.ts tests/server.history.test.ts
git commit -m "feat(accounts): scope history routes by account from auth context"
```

---

### Task 8: Update summarize route to record account in history

**Files:**

- Modify: `src/server/routes/summarize.ts`

- [ ] **Step 1: Thread account into history inserts**

In `src/server/routes/summarize.ts`:

At the top of the `route.post("/summarize", async (c) => {` handler, add:

```typescript
const account = c.get("account") as string;
```

Update the log line to include account:

```typescript
console.log(
  `[summarize-api] [${account}] summarize request: mode=${mode} source=${source} length=${lengthRaw}${modelOverride ? ` model=${modelOverride}` : ""}`,
);
```

In both history insert blocks (URL mode ~line 228 and text mode ~line 307), add `account` to the entry:

```typescript
deps.historyStore!.insert({
  id: historyId,
  createdAt: new Date().toISOString(),
  account,
  sourceUrl: body.url!,
  // ...rest unchanged
});
```

And the text mode insert:

```typescript
deps.historyStore!.insert({
  id: historyId,
  createdAt: new Date().toISOString(),
  account,
  sourceUrl: null,
  // ...rest unchanged
});
```

- [ ] **Step 2: Verify build compiles**

Run: `pnpm -s build`
Expected: SUCCESS

- [ ] **Step 3: Update summarize route tests**

In `tests/server.summarize.test.ts`, update the test setup:

- Replace `apiToken: "test-token"` with `accounts: [{ name: "test-user", token: "test-token-that-is-at-least-32-chars!" }]` in `createApp()` deps.
- Add auth middleware simulation or auth header `Authorization: Bearer test-token-that-is-at-least-32-chars!` to requests that need it.
- If the test records history, verify `insertedEntries[0].account === "test-user"`.

Run: `pnpm vitest run tests/server.summarize.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/summarize.ts tests/server.summarize.test.ts
git commit -m "feat(accounts): record account in history from summarize route"
```

---

### Task 9: Update server wiring (index.ts + main.ts)

**Files:**

- Modify: `src/server/index.ts`
- Modify: `src/server/main.ts`

- [ ] **Step 1: Update server index.ts**

In `src/server/index.ts`:

Update imports:

```typescript
import type { Account } from "../config.js";
import { createMeRoute } from "./routes/me.js";
```

Replace `ServerDeps` — remove `apiToken: string | null` and add `accounts: Account[]`:

```typescript
export type ServerDeps = SummarizeRouteDeps & {
  accounts: Account[];
};
```

Remove all three `authMiddleware(deps.apiToken)` calls in `createApp` and replace with a shared `auth` constant.

Update `createApp`:

- Replace `authMiddleware(deps.apiToken)` calls with `authMiddleware(deps.accounts)`
- Add `/v1/me` route (protected):

```typescript
// Protected: /v1/me
const auth = authMiddleware(deps.accounts);
app.use("/v1/me", auth);
app.route("/v1", createMeRoute());

// Protected: /v1/summarize
const summarizeRoute = createSummarizeRoute(deps);
app.use("/v1/summarize", auth);
app.use("/v1/summarize", bodyLimit({ maxSize: 10 * 1024 * 1024 }));
app.route("/v1", summarizeRoute);

// History routes (protected)
if (deps.historyStore) {
  const historyRoute = createHistoryRoute({
    historyStore: deps.historyStore,
    historyMediaPath: deps.historyMediaPath ?? null,
  });
  app.use("/v1/history/*", auth);
  app.use("/v1/history", auth);
  app.route("/v1", historyRoute);
}
```

- [ ] **Step 2: Update server main.ts**

Replace `src/server/main.ts`:

```typescript
import { serve } from "@hono/node-server";
import { loadSummarizeConfig } from "../config.js";
import { createCacheStateFromConfig } from "../run/cache-state.js";
import { createMediaCacheFromConfig } from "../run/media-cache-state.js";
import {
  createHistoryStateFromConfig,
  resolveHistoryMediaPathFromConfig,
} from "../run/history-state.js";
import { createApp } from "./index.js";

const env = { ...process.env };
const port = Number(env.SUMMARIZE_API_PORT) || 3000;

// Deprecation warning for old single-token env var
if (env.SUMMARIZE_API_TOKEN) {
  console.warn(
    "[summarize-api] SUMMARIZE_API_TOKEN is deprecated and ignored. Use accounts config instead.",
  );
}

const { config } = loadSummarizeConfig({ env });

// Require accounts config
if (!config?.accounts || config.accounts.length === 0) {
  console.error(
    "[summarize-api] No accounts configured. Add an 'accounts' array to ~/.summarize/config.json.",
  );
  console.error("[summarize-api] Example:");
  console.error(
    '[summarize-api]   "accounts": [{ "name": "myname", "token": "<32+ char token>" }]',
  );
  process.exit(1);
}

const accounts = config.accounts;
console.log(
  `[summarize-api] ${accounts.length} account(s) configured: ${accounts.map((a) => a.name).join(", ")}`,
);

const cache = await createCacheStateFromConfig({ envForRun: env, config, noCacheFlag: false });
const mediaCache = await createMediaCacheFromConfig({ envForRun: env, config });
const historyStore = await createHistoryStateFromConfig({ envForRun: env, config });
const historyMediaPath = resolveHistoryMediaPathFromConfig({ envForRun: env, config });

const app = createApp({ env, config, cache, mediaCache, accounts, historyStore, historyMediaPath });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[summarize-api] Listening on http://0.0.0.0:${info.port}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[summarize-api] ${signal} received, shutting down...`);
    historyStore?.close();
    server.close(() => process.exit(0));
    setTimeout(() => {
      console.error("[summarize-api] Forced shutdown after timeout");
      process.exit(1);
    }, 30_000).unref();
  });
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm -s build`
Expected: SUCCESS

- [ ] **Step 4: Run all server tests**

Run: `pnpm vitest run tests/server.*.test.ts tests/history.test.ts`
Expected: ALL PASS

Note: `tests/server.summarize.test.ts` and `tests/server.frontend.test.ts` use `createApp()` — they will need `accounts` instead of `apiToken` in deps. Update the test helper in those files:

- Replace `apiToken: "test-token"` with `accounts: [{ name: "test-user", token: "test-token-that-is-at-least-32-chars!" }]`
- Add auth header `Authorization: Bearer test-token-that-is-at-least-32-chars!` to requests that need auth

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts src/server/main.ts
git commit -m "feat(accounts): wire multi-account into server startup and app factory"
```

---

## Chunk 5: Frontend + Final Verification

### Task 10: Update web frontend to show greeting

**Files:**

- Modify: `src/server/public/index.html`

- [ ] **Step 1: Add /v1/me call and greeting display**

In `src/server/public/index.html`, find the JavaScript section where the token is extracted from the URL. After the token is available, add:

```javascript
// Fetch account name and display greeting
if (apiToken) {
  fetch("/v1/me", {
    headers: { Authorization: `Bearer ${apiToken}` },
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data?.account?.name) {
        const greeting = document.getElementById("account-greeting");
        if (greeting) {
          greeting.textContent = `Hi, ${data.account.name}`;
          greeting.style.display = "";
        }
      }
    })
    .catch(() => {
      /* degrade gracefully */
    });
}
```

Add the greeting element in the header area (find the appropriate spot in the HTML):

```html
<span id="account-greeting" style="display: none;"></span>
```

The exact placement depends on the current header layout — position it where it naturally fits (e.g., top-right of the header bar).

- [ ] **Step 2: Verify manually by loading the web UI**

Run: `pnpm -s build`
Then test by starting the server with accounts config and opening the web UI.

- [ ] **Step 3: Commit**

```bash
git add src/server/public/index.html
git commit -m "feat(accounts): show account greeting in web frontend"
```

---

### Task 11: Run full test suite and fix any remaining issues

- [ ] **Step 1: Run full test suite**

Run: `pnpm vitest run`
Expected: ALL PASS

- [ ] **Step 2: Fix any failures**

Address any remaining test failures from:

- `tests/server.frontend.test.ts` — needs `accounts` instead of `apiToken` in deps
- `tests/server.health.test.ts` — may need `accounts` if it creates the full app via `createApp()`
- `tests/daemon.auth.test.ts` — may be unaffected (separate daemon auth), verify
- Any other tests that reference the old `apiToken` field

- [ ] **Step 3: Run build**

Run: `pnpm -s build`
Expected: SUCCESS

- [ ] **Step 4: Run check gate**

Run: `pnpm -s check`
Expected: SUCCESS

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -u
git commit -m "fix(accounts): update remaining tests for multi-account"
```

---

### Task 12: Update deployment config

- [ ] **Step 1: Update production config**

SSH into production and add accounts to `~/.summarize/config.json`:

```json
{
  "accounts": [{ "name": "sebastian", "token": "<generate with: openssl rand -base64 32>" }]
}
```

- [ ] **Step 2: Remove SUMMARIZE_API_TOKEN from .env / docker-compose**

The old env var is no longer needed. Remove it from the Docker compose environment.

- [ ] **Step 3: Rebuild and redeploy**

```bash
docker buildx build --platform linux/amd64 -t ghcr.io/perelin/summarize-api:latest --push .
ssh pve-htz-docker 'cd /opt/apps/summarize && docker compose pull -q && docker compose up -d'
```

- [ ] **Step 4: Verify**

```bash
curl -s https://summarize.p2lab.com/v1/me -H "Authorization: Bearer <new-token>" | jq
```

Expected: `{ "account": { "name": "sebastian" } }`
