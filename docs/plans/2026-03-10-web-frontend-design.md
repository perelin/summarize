# Summarize Web Frontend — Design Document

**Date:** 2026-03-10
**Status:** Approved

## Context

The summarize API server (`POST /v1/summarize`) exists and works for scripts/automation. We want a simple web frontend so humans can use it from a browser — paste a URL or text, pick a length, get a rendered markdown summary.

## Constraints

- No backend changes to the summarize pipeline
- API is synchronous (no streaming/SSE) — progress is a spinner with elapsed time
- Single static HTML file, no build step, no new npm dependencies
- Served from the same Hono server (same-origin, no CORS)
- Token passed via URL query parameter (`?token=abc123`)

## Architecture

Single HTML file at `src/server/public/index.html`, served by Hono at `GET /`.

```
Browser → GET /?token=abc123 → Hono serves index.html
Browser → POST /v1/summarize (same origin, Bearer token from URL param)
         → waits (spinner + elapsed timer)
         → receives JSON → parses markdown → renders
```

No CORS. No build step. No new npm dependencies. Markdown rendered client-side via `marked` (CDN).

## UI Layout

Minimal single-page layout:

1. **Header** — "Summarize" title
2. **Input section** — two tabs: "URL" and "Text"
   - URL tab: single text input
   - Text tab: textarea
   - Length dropdown: `tiny` / `short` / `medium` / `long` / `xlarge` (default: `medium`)
   - "Summarize" button
3. **Progress indicator** — pulsing dot + "Summarizing... (23s)" with elapsed time
4. **Result section** — rendered markdown summary + metadata footer (model, duration, token usage)
5. **Error display** — inline error message

## Token Handling

- Read from `?token=` query parameter on page load
- If missing, show: "Add `?token=your-token` to the URL to authenticate"
- Sent as `Authorization: Bearer <token>` header on API calls
- Stays in URL bar — bookmarkable

## Markdown Rendering

`marked` from CDN (~8KB). Minimal CSS for typography — headings, lists, code blocks, links.

## Server Changes

- Add `GET /` route to Hono app (no auth required) serving the static HTML
- HTML file read from disk or inlined at startup

## Key Decisions

1. **Same-origin serving** — avoids CORS complexity entirely
2. **URL param for token** — simplest auth UX, bookmarkable
3. **No streaming** — spinner with elapsed time is good enough for v1
4. **Single HTML file** — no build tooling, easy to iterate
5. **CDN for marked** — avoids adding npm dependency for a single static page
