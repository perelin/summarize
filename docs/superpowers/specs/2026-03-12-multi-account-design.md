# Multi-Account Support — Design Spec

**Date:** 2026-03-12
**Status:** Draft

## Goal

Allow multiple friends to use the same summarize server with isolated history. Each account gets its own token and sees only its own summaries.

## Non-Goals (for now)

- Admin API or CLI for account management
- Self-service signup
- Per-account configuration (model, length defaults)
- Usage tracking or quotas
- Backwards compatibility with single-token mode

## Config Schema

Accounts are defined in `~/.summarize/config.json`:

```json
{
  "accounts": [
    { "name": "sebastian", "token": "sk-seb-abc123def456ghijklmnopqrst" },
    { "name": "alice", "token": "sk-alice-xyz789ghi012jklmnopqrstuv" }
  ],
  "history": { ... }
}
```

### Validation Rules (enforced at startup)

- `accounts` array is **required** and must contain at least one entry. Server exits with error if missing.
- `name`: required, unique, non-empty, lowercase alphanumeric + hyphens.
- `token`: required, unique, minimum 32 characters.
- Duplicate names or tokens → startup error with clear message.
- `SUMMARIZE_API_TOKEN` env var: if present, log deprecation warning and ignore it.

### Implementation Notes

- Add `accounts?: Account[]` to `SummarizeConfig` type in `src/config/types.ts`.
- Define `Account` type: `{ name: string; token: string }`.
- Add `parseAccountsConfig()` validation function to config parsing.

## Auth Middleware

**File:** `src/server/middleware/auth.ts`

- Build a `Map<token, accountName>` from the accounts config at startup.
- Incoming request: extract token (Bearer header or `?token=` query param), look up in map.
- If found: set `c.set("account", accountName)` on Hono context for downstream routes.
- If not found: return 401 (same as today).
- Map lookup is sufficient for "share with friends" scope — no timing-safe iteration needed across multiple tokens.
- Signature changes from `authMiddleware(token: string)` to `authMiddleware(accounts: Account[])`.

### Hono Typed Context

Extend Hono's `Variables` type so `c.get("account")` returns `string` instead of `unknown`:

```typescript
type Variables = { account: string };
// Use Hono<{ Variables: Variables }> for route definitions
```

## History Storage

**File:** `src/history.ts`

### Schema Change

Add `account TEXT NOT NULL` column to the `history` table and to the `HistoryEntry` type:

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

The `HistoryEntry` TypeScript type gains `account: string`.

### Index

```sql
CREATE INDEX IF NOT EXISTS idx_history_account_created ON history(account, created_at DESC)
```

### Migration Strategy

No migration. If the existing table lacks the `account` column, **drop and recreate** the table. Log a prominent warning before dropping: `"[summarize-api] history: dropping legacy history table (no account column) — starting fresh"`.

### Query Scoping

All history operations gain `WHERE account = ?`:

- `insert(entry)` — `entry.account` is written to DB.
- `list(account, limit, offset)` — filtered by account. **The total count query must also be scoped:** `SELECT COUNT(*) AS total FROM history WHERE account = ?`.
- `get(id, account)` — returns null if wrong account (prevents cross-account ID guessing).
- `delete(id, account)` — same guard.

### Media Storage

No changes to file layout. Media files are referenced by history entry ID. The media streaming endpoint **must call `get(id, account)` and return 404 if null** before reading the file from disk. This ensures application-level account isolation.

## Route Changes

### `POST /v1/summarize`

Read `c.get("account")` from context, set on the history entry before inserting. Log lines include account name: `[summarize-api] [sebastian] summarize request: ...`.

### `GET /v1/history`

Pass `c.get("account")` to `list()`. Both results and total count are scoped.

### `GET /v1/history/:id`

Pass `c.get("account")` to `get()`. Return 404 if wrong account.

### `GET /v1/history/:id/media`

Call `get(id, account)` and return 404 if null, before reading the file from disk.

### `DELETE /v1/history/:id`

Pass `c.get("account")` to `delete()`. Return 404 if wrong account.

### `GET /v1/me` (new)

Auth required. Returns `{ "account": { "name": "<account_name>" } }`. Wrapped in `account` object for future extensibility (quotas, preferences).

### `GET /v1/health`

No change (no auth).

## Web Frontend

**File:** `src/server/public/index.html`

- On load, call `GET /v1/me` to get account name.
- Display greeting (e.g., "Hi, sebastian") in the header area.
- If `/v1/me` returns 401, degrade gracefully — no greeting, page works normally.
- No other changes needed — all API calls already send the token, and the server scopes responses by account.

## Server Startup

**File:** `src/server/main.ts`

1. Load `accounts` from config.
2. Validate: array exists, non-empty, names/tokens unique, format rules. Exit with clear error on failure.
3. If `SUMMARIZE_API_TOKEN` env var is set, log deprecation warning.
4. Detect missing `account` column in history table → log warning, drop and recreate.
5. Pass accounts to `authMiddleware(accounts)` and app factory.

## Test Plan

### Files to Update

- `tests/server.auth.test.ts` — `createTestApp(token)` signature changes to `createTestApp(accounts)`.
- `tests/server.history.test.ts` — all store calls need account scoping.

### New Test Scenarios

- **Cross-account isolation:** account A creates an entry, account B cannot see/access/delete it.
- **Account validation:** missing accounts config → startup error. Duplicate names/tokens → error. Short tokens → error.
- **`GET /v1/me`:** returns correct account name for each token.
- **Media isolation:** account A cannot stream account B's media via ID guessing.
