# Share Links for History Entries

Public, unauthenticated share links for summarized content.

## Problem

Users want to share summaries with others (colleagues, friends, social media) via a simple link. Currently all content is behind authentication — there's no way to give someone read access without giving them an account token.

## Requirements

- Public share links: no login required to view
- Visible content: title, summary (markdown), metadata (source, type, model, duration, word count, date), source link
- Length-switcher: visitors can re-summarize at a different length (rate-limited)
- Not visible: chat, transcript, media player, delete, internal IDs
- Widerrufbar: owner can unshare; no auto-expiry
- Own token/route: `/share/:token` with random token, decoupled from internal entry ID
- Invalid/revoked tokens return 404 (no information leak)
- Footer text: "Content is AI-generated"

## Approach: Flag on History Table

A `shared_token` column directly on the `history` table. `NULL` = not shared, populated = public via that token.

**Why this over a separate table:** One share link per entry is sufficient. Avoids a second table, joins, and extra CRUD. If multiple links per entry become needed later, migration to a dedicated table is straightforward.

## Data Model

### Migration

```sql
ALTER TABLE history ADD COLUMN shared_token TEXT;
CREATE UNIQUE INDEX idx_history_shared_token ON history(shared_token) WHERE shared_token IS NOT NULL;
```

The partial unique index ensures fast token lookups while allowing many `NULL` rows without index bloat.

### Token Format

12-character nanoid (URL-safe alphabet: `A-Za-z0-9_-`). Provides ~71 bits of entropy — sufficient for unguessable tokens at this scale.

## API Endpoints

All under `/v1`.

### `POST /v1/history/:id/share` (auth required)

Creates a share token for the entry.

- Validates entry belongs to authenticated account
- Generates 12-char nanoid, stores in `shared_token`
- If entry already has a token, returns the existing one (idempotent)
- Response: `{ token: string, url: string }`

### `DELETE /v1/history/:id/share` (auth required)

Revokes the share link.

- Sets `shared_token = NULL`
- Response: `204 No Content`

### `GET /v1/shared/:token` (no auth)

Returns the public payload for a shared entry.

- Looks up entry by `shared_token`
- 404 if not found (same response whether token never existed or was revoked)
- Response:

```typescript
{
  title: string | null;
  summary: string;
  sourceUrl: string | null;
  sourceType: string;
  model: string;
  createdAt: string;
  inputLength: string;
  metadata: {
    mediaDurationSeconds?: number;
    wordCount?: number;
  };
}
```

No `id`, `account`, `transcript`, `mediaPath`, or other internal fields.

### `POST /v1/shared/:token/resummarize` (no auth, rate-limited)

Re-summarizes the shared entry at a different length.

- Request: `{ length: "tiny" | "short" | "medium" | "long" | "xlarge" }`
- Validates token, finds entry, calls summarization pipeline with new length
- Rate limit: 10 requests per token per hour (in-memory counter, resets on server restart)
- Returns SSE stream (same format as `/v1/summarize`) or JSON result
- **Does NOT update the stored entry.** The result is transient — returned to the visitor but not persisted. The owner's saved summary remains unchanged.
- Response format matches existing resummarize endpoint

## Frontend

### Router Change

New route in `apps/web/src/lib/router.tsx`:

```typescript
type Route =
  | { view: "summarize" }
  | { view: "history" }
  | { view: "summary"; id: string }
  | { view: "shared"; token: string }   // NEW
```

Pattern: `/share/:token` → `{ view: "shared", token }`

### Share Button in `SummaryDetail`

Added to the existing action bar (alongside DiscussIn and LengthSwitcher).

**Not shared state:**
- Button: share icon + "Share"
- Click → `POST /v1/history/:id/share` → copies link to clipboard → transitions to shared state

**Shared state:**
- Button: link icon + "Shared ✓" (accent color background)
- Below action bar: link bar showing URL + "Copy" button + "Unshare" button
- Copy → clipboard + brief "Copied!" feedback
- Unshare → confirm dialog → `DELETE /v1/history/:id/share` → transitions back

The `shared_token` field must be included in the `HistoryDetailEntry` API response so the frontend knows the current share state.

### `SharedSummaryView` Component

New component at `apps/web/src/components/shared-summary-view.tsx`.

Standalone component (not a wrapper around `SummaryDetail`) that fetches from the public endpoint and renders:

1. **Header:** "Summarize" branding (left), "Shared summary" label (right)
2. **Title:** Entry title in display font
3. **Source link:** External link to original content
4. **Metadata badges:** type, model, input length, duration, word count, date
5. **Length-switcher:** Calls `/v1/shared/:token/resummarize`
6. **Summary:** Markdown-rendered content (reuses `StreamingMarkdown` component)
7. **Footer:** "Created with Summarize" (left), "Content is AI-generated" (right)

**Error states:**
- 404 → "This shared summary is no longer available"
- Network error → generic error message
- Rate limit hit on resummarize → "Please try again later"

### API Client Addition

New functions in `apps/web/src/lib/api.ts`:

- `fetchSharedSummary(token: string)` → `GET /v1/shared/:token`
- `resummarizeShared(token: string, length: string)` → `POST /v1/shared/:token/resummarize`
- `createShare(id: string)` → `POST /v1/history/:id/share`
- `deleteShare(id: string)` → `DELETE /v1/history/:id/share`

These functions do NOT use the auth token (except `createShare` and `deleteShare`).

## Rate Limiting

Simple in-memory Map keyed by share token. Each entry tracks request count and window start time. Resets after 1 hour or on server restart. No persistence needed — this is a soft limit to prevent abuse, not a billing boundary.

```
Map<string, { count: number; windowStart: number }>
```

Max 10 resummarize requests per token per hour.

## Security Considerations

- **Token entropy:** 12-char nanoid (~71 bits) makes brute-force enumeration infeasible
- **No ID exposure:** Public endpoint uses share token, never internal entry ID
- **Uniform 404:** Invalid and revoked tokens return identical 404 responses
- **Payload filtering:** Public response explicitly picks allowed fields — no risk of leaking internal data
- **Rate limiting:** Prevents abuse of LLM-backed resummarize endpoint
- **Account isolation:** Share/unshare endpoints verify entry ownership via auth token

## Out of Scope

- Expiry dates for share links
- Multiple share links per entry
- Password-protected shares
- Analytics/view counting
- Social media preview (Open Graph tags) — could be added later
- Transcript or media sharing
