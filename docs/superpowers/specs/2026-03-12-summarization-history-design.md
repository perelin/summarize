# Summarization History — Design Spec

**Date:** 2026-03-12
**Status:** Draft
**Scope:** API server only (CLI excluded for now)

## Overview

Persist every successful summarization as a permanent, browsable history. Users can revisit past summaries, read transcripts, and play back media from a chronological history view in the web UI.

## Decisions

| Decision         | Choice                    | Rationale                                                    |
| ---------------- | ------------------------- | ------------------------------------------------------------ |
| Primary use case | Personal archive          | Browse and revisit past summarizations                       |
| Entry point      | API server only           | CLI excluded for now                                         |
| Media storage    | Local disk                | Simple; S3 upgrade path later                                |
| Browsing model   | Chronological list        | No search/filtering in v1                                    |
| Access surface   | API endpoint + web UI     | Immediately useful                                           |
| History vs cache | Separate                  | Cache is ephemeral optimization; history is permanent record |
| Database         | Separate `history.sqlite` | Clean separation from cache; independent backup/migration    |

## 1. Database Schema

**File:** `~/.summarize/history.sqlite` (separate from `cache.sqlite`)

**Pragmas:** `journal_mode=WAL`, `synchronous=NORMAL`, `auto_vacuum=INCREMENTAL`, `busy_timeout=5000` (match existing cache DB settings).

```sql
CREATE TABLE history (
  id            TEXT PRIMARY KEY,        -- UUID v4
  created_at    TEXT NOT NULL,           -- ISO 8601 timestamp

  -- Input
  source_url    TEXT,                    -- Original URL (null for text-mode)
  source_type   TEXT,                    -- "article", "video", "podcast", "text"
  input_length  TEXT NOT NULL,           -- "tiny", "short", "medium", "long", "xlarge"
  model         TEXT NOT NULL,           -- Model used (e.g., "anthropic/claude-sonnet-4")

  -- Output
  title         TEXT,                    -- Extracted title
  summary       TEXT NOT NULL,           -- Markdown summary

  -- Transcript (only for audio/video — null for plain articles)
  transcript    TEXT,                    -- Transcript text; only populated when transcriptSource is set

  -- Media reference
  media_path    TEXT,                    -- Relative path to media file in history media dir
  media_size    INTEGER,                -- Size in bytes
  media_type    TEXT,                    -- MIME type

  -- Metadata (JSON blob — insights, tokens, cost, duration, stages, etc.)
  metadata      TEXT                     -- JSON-serialized SummarizeInsights + extras
);

CREATE INDEX idx_history_created ON history(created_at DESC);
```

### Key design choices

- **UUID primary key** — no auto-increment; works if we ever sync/merge databases.
- **Transcript column** — only populated when `transcriptSource` is non-null (audio/video content). For plain articles, `transcript` stays null — the article body is not a transcript.
- **Metadata as JSON** — `SummarizeInsights` and other enrichment data stored as a JSON blob. Avoids schema migrations when insight fields change. Queryable via SQLite JSON functions if needed later.
- **`model` is NOT NULL** — on a full cache hit where `onModelChosen` never fires, use `result.usedModel` (from `streamSummaryForUrl` return value) or fall back to `response.metadata.model`. There is always a model value available in the route handler.
- **No TTL, no eviction** — history is permanent until explicitly deleted.

## 2. Media Storage

**Directory:** `~/.summarize/history/media/`

**File naming:** `<history-entry-id>.<original-extension>` (e.g., `a1b2c3d4-e5f6-...-.mp3`)

### Lifecycle

1. When a summarization completes and the pipeline used a media file (from the ephemeral media cache), **copy** the file to the history media dir.
2. The `media_path` column stores just the filename (relative to the history media dir).
3. No TTL, no eviction — permanent until the user deletes the history entry.
4. No re-download — we copy from the existing media cache, not from the source URL.

### S3 upgrade path

When S3 is desired later, swap the "copy to local dir" logic for "upload to S3" and store an S3 key instead of a local path. The rest of the system (DB schema, API, UI) doesn't change.

## 3. API Endpoints

All endpoints require the existing Bearer token auth.

### `GET /v1/history`

Paginated chronological list.

**Query params:** `limit` (default 20, max 100), `offset` (default 0)

**Response:**

```json
{
  "entries": [
    {
      "id": "a1b2c3d4-...",
      "createdAt": "2026-03-12T14:30:00Z",
      "sourceUrl": "https://example.com/article",
      "sourceType": "article",
      "title": "Article Title",
      "summary": "# Article Title\n\nSummary...",
      "model": "anthropic/claude-sonnet-4",
      "length": "short",
      "hasTranscript": false,
      "hasMedia": false
    }
  ],
  "total": 142,
  "limit": 20,
  "offset": 0
}
```

### `GET /v1/history/:id`

Single entry with full detail including transcript.

**Response:**

```json
{
  "id": "a1b2c3d4-...",
  "createdAt": "2026-03-12T14:30:00Z",
  "sourceUrl": "https://example.com/podcast.mp3",
  "sourceType": "podcast",
  "title": "Episode 546",
  "summary": "# Episode 546\n\n...",
  "transcript": "Full transcript text...",
  "model": "anthropic/claude-sonnet-4",
  "length": "short",
  "hasMedia": true,
  "mediaUrl": "/v1/history/a1b2c3d4-.../media",
  "metadata": { ... }
}
```

### `GET /v1/history/:id/media`

Serves the stored media file with correct `Content-Type` header. Streams the file.

### `DELETE /v1/history/:id`

Deletes the history entry and its associated media file (if any). Returns `204 No Content` on success. Returns `404 Not Found` if the entry does not exist.

## 4. Web UI

Extend the existing single-page web frontend (`index.html` served by Hono).

### Navigation

Add a "History" link/tab to the page header, toggling between the summarize form and the history view.

### History list view

- Reverse-chronological list of entries.
- Each row: title (or truncated URL if no title), source type badge (article/video/podcast/text), date, model.
- Clicking a row opens the detail view.
- "Load more" button at the bottom (offset-based pagination).

### Detail view

- Full summary rendered as markdown.
- Metadata section: source URL (clickable link), model, length, cost, duration, token counts.
- Expandable transcript section (collapsed by default).
- HTML5 `<audio>` or `<video>` player if media exists (source: `/v1/history/:id/media`).
- Delete button with confirmation dialog.

### Implementation

Vanilla JS/HTML — same pattern as the existing web UI. No SPA framework.

## 5. Recording Flow

### When to record

After `POST /v1/summarize` completes successfully. **Not** for `extract`-only requests (no summary to archive).

### Data access

Currently, `streamSummaryForUrl` does not expose `ExtractedLinkContent` to the route handler — it only returns `{ usedModel, report, metrics, insights }`. To support history recording, **extend `streamSummaryForUrl`** (and `streamSummaryForVisiblePage`) to also return:

- `extracted: ExtractedLinkContent` — needed for transcript text and source type detection
- `mediaFilePath: string | null` — the path to the media file in the cache (if one was used)

This keeps the recording logic in the route handler where all context (request params, response, extracted content) is available.

For `mediaFilePath`: after the flow completes, resolve it by looking up the media cache entry via `mediaCache.get({ url: input.url })`. The media cache is keyed by URL, so no new hooks are needed — just a post-flow lookup.

### How

1. **Before returning the response**, collect the history payload (entry data + media file path). This ensures the media file reference is captured while the cache entry is still guaranteed to exist.
2. **Copy media first** (if applicable): `await fs.copyFile(...)` from `~/.summarize/cache/media/` to `~/.summarize/history/media/` before returning the response. This avoids a race where cache eviction removes the file. (Use async `fs.copyFile`, not blocking `fs.copyFileSync`.)
3. **Return the response** to the client.
4. **Fire-and-forget the DB insert**: `void recordHistory(payload).catch(log.error)` — the DB write is fast and non-blocking. If it fails, the media file is orphaned (acceptable; can be cleaned up later).
5. Never let history recording break the summarization flow — all errors are caught and logged.

### Transcript field mapping

The `transcript` column is populated from `extracted.content` **only when** `extracted.transcriptSource` is non-null (i.e., audio/video content was transcribed). For plain article URLs, `transcript` is null — the article body is not a transcript.

### Source type detection

Derived from `SummarizeInsights` fields (all available at recording time):

| Condition                                                                      | Source type                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------- |
| `insights.transcriptSource` contains "youtube" / "captionTracks" / "yt-dlp"    | `"video"`                                   |
| `insights.mediaDurationSeconds` present + `insights.transcriptionProvider` set | `"podcast"` (default for non-YouTube media) |
| Text-mode input (no URL in request)                                            | `"text"`                                    |
| Everything else                                                                | `"article"`                                 |

Note: the video vs. podcast distinction for non-YouTube media is imperfect without MIME type info. Defaulting to "podcast" for all non-YouTube transcribed media is good enough for v1. Can be refined later by adding `mediaType` to insights.

## 6. Configuration

Add a `history` section to `SummarizeConfig`:

```typescript
history?: {
  enabled?: boolean;       // Default: true
  path?: string;           // Default: ~/.summarize/history.sqlite
  mediaPath?: string;      // Default: ~/.summarize/history/media/
}
```

**Environment variable override:** `SUMMARIZE_HISTORY_ENABLED=false` to disable without touching config.

No TTL or max size settings — permanent archive. Retention policies can be added later if needed.

**Path resolution:** Reuse the existing `resolveHomeDir()` utility from `src/cache.ts` for `~` expansion. Same contract as the cache paths.

## 7. Docker / Deployment

No changes needed. The existing bind mount `./data:/root/.summarize` covers:

- `history.sqlite` → `./data/history.sqlite`
- `history/media/` → `./data/history/media/`

## Out of Scope (v1)

- CLI history recording
- Full-text search
- Filtering by source type, domain, date range
- S3 media storage
- History export/import
- Re-summarize from history (with different model/length)
- Retention policies / auto-cleanup
