# Design: Deprecate Chrome Extension, Migrate Features to Web Server

**Date:** 2026-03-13
**Status:** Approved
**Approach:** A — Delete extension/daemon transport, relocate business logic, enhance web server + frontend

## Context

The project has two parallel codepaths for delivering summarization:

1. **Chrome extension** (`apps/chrome-extension/`, ~17K LOC) talks to a **local daemon** (`src/daemon/server.ts`, port 8787) via HTTP/SSE. Feature-rich: summarize, chat, slides extraction, agent/automation, hover tooltips.
2. **Web server** (`src/server/`, Hono on port 3000) serves a **web frontend** (`src/server/public/index.html`, ~1,700 LOC vanilla JS). Simple: summarize + history.

The project is pivoting to a central web service for friends. The Chrome extension is unused. The daemon's only consumer is the extension. The web frontend needs the extension's best features.

A future Chrome extension (if needed) would be a thin wrapper loading the responsive web frontend — not a reimplementation.

## Decision

**Delete** the Chrome extension and daemon transport layer. **Relocate** shared business logic (summarization pipeline, chat, slides). **Enhance** the web server with SSE streaming, slides, and chat endpoints. **Rebuild** the frontend with Preact + Vite.

## What Gets Deleted

- `apps/chrome-extension/` — all 89 files (~17K LOC)
- `src/daemon/server.ts` — daemon HTTP transport (~1,400 LOC)
- `src/daemon/server-http.ts` — HTTP utilities
- `src/daemon/server-session.ts` — session management
- `src/daemon/cli.ts` — daemon install/status/restart/uninstall commands
- `src/daemon/launchd.ts`, `systemd.ts`, `schtasks.ts` — platform service managers
- `src/daemon/config.ts`, `constants.ts` — daemon-specific config
- `src/daemon/env-snapshot.ts`, `env-merge.ts` — env capture for service managers
- `src/daemon/process-registry.ts` — process tracking (daemon-only feature)
- `src/daemon/agent.ts` — browser automation agent (requires content scripts, debugger API — not portable to web)
- `src/daemon/cli-entrypoint.ts` — daemon CLI entrypoint
- Daemon test files (~20 files)
- Extension test files
- Extension build config (`apps/chrome-extension/wxt.config.ts`, etc.)
- CLI references to daemon commands (cleanup `src/run/cli-preflight.ts` → remove `handleDaemonRequest` import)

## What Gets Relocated

These files currently live in `src/daemon/` but contain business logic used by both daemon and web server. They move to **`packages/core/src/`** (the `@steipete/summarize-core` package). This is the correct home because core already contains content extraction, transcription, and prompts — the summarization pipeline belongs there.

Implications of relocating to `packages/core/`:

- Relocated modules must be exported from core's `index.ts`
- Core's build must be updated to include the new files
- Downstream imports in the CLI package change from relative `../../daemon/...` paths to `@steipete/summarize-core/...`
- The web server route (`src/server/routes/summarize.ts`) updates its imports similarly

Files to relocate:

- `summarize.ts` — core summarization pipeline (`streamSummaryForUrl`, `extractContentForUrl`). Note: `streamSummaryForVisiblePage` (takes pre-extracted page text from extension content scripts) is relocated too for potential future use by a thin extension wrapper, but the web server will only use `streamSummaryForUrl`.
- `summarize-progress.ts` — progress formatting (imported by `summarize.ts`, needed for SSE `status` events)
- `chat.ts` — chat response streaming. **Note:** this file will need significant adaptation, not just a move. The current `chat.ts` uses daemon `Session.lastMeta` for context; the web server version needs to work with `summaryId`-based context (loading summary + metadata from history DB). Plan for a rewrite of the session/context interface during relocation.
- `flow-context.ts` — flow context for summarization
- `meta.ts` — metadata extraction
- `models.ts` — model listing/selection. **Note:** currently calls `resolveCliAvailability` to detect local CLI binaries (ollama, etc.) which is irrelevant on a remote web server. Drop CLI-local checks during adaptation.
- Slide extraction logic (needs exploration — may be in summarize.ts or separate)

**Not relocated** (deleted or unnecessary in web context):

- `agent.ts` — browser automation, inherently extension-specific (see "What Gets Deleted")
- `auto-mode.ts` — decides between "page" mode (extension sends visible page text) and "url" mode (server fetches URL). In the web context, the server always fetches the URL, so this logic is not needed. If any useful heuristics exist, inline them into the web server route.

## Web Server: New Endpoints

All behind existing Bearer token auth middleware.

### Streaming Summarization

The existing `POST /v1/summarize` endpoint changes to support SSE streaming:

- Client sends `Accept: text/event-stream` header to opt into streaming (JSON response remains the default for backward compatibility)
- SSE event schema **evolves** the existing contract from `src/shared/sse-events.ts`. The current schema defines: `status` (`{text}`), `chunk` (`{text}`), `metrics`, `assistant`, `slides`, `done` (empty `{}`), `error` (`{message}`). The **new target schema** extends this for the web server's needs:
  - `status` — `{text: string}` — progress updates (unchanged from current)
  - `chunk` — `{text: string}` — incremental summary text (unchanged, keeping the name `chunk` not `token`)
  - `meta` — `{title, wordCount, sourceType, ...}` — metadata about the source (new event, replaces implicit metadata in `done`)
  - `done` — `{summaryId: string}` — **breaking change**: adds `summaryId` to the previously empty `done` payload, needed for chat/slides requests
  - `error` — `{code: string, message: string}` — **extends current**: adds machine-readable `code` field alongside existing `message`
  - `metrics`, `slides` — carried forward unchanged
  - `src/shared/sse-events.ts` itself should relocate to `packages/core/` since both the web server and core need these types
- The `summaryId` in the `done` event is the primary key clients use for subsequent chat and slides requests. For non-streaming JSON responses, `summaryId` is included in the response body.
- **Session management:** Session metadata (summaryId, account, timestamps) persists in SQLite. SSE event buffers remain **in-memory** — streaming is inherently ephemeral, and persisting token-by-token events to disk would be too slow. On server restart, active streams break (clients reconnect and get the final result from history if available). Late-joining SSE clients receive buffered events from the in-memory buffer (15-min TTL, 1MB cap — same as current daemon).
- **SSE reconnection:** Server includes `id` fields on events. Clients can send `Last-Event-ID` on reconnect to resume from where they left off (within the buffer TTL).

### Slides

- `POST /v1/summarize/:summaryId/slides` — trigger slide extraction for a completed summary
- `GET /v1/summarize/:summaryId/slides/events` — SSE stream of slide extraction progress
- `GET /v1/slides/:sourceId/:index` — serve slide images (with caching headers). `:sourceId` is a content-derived ID (hash of video URL) from the slides subsystem (`src/slides/source-id.ts`), distinct from `summaryId`. The `done` event of slide extraction includes the `sourceId` for constructing image URLs.

### Chat

- `POST /v1/chat` — send a follow-up message in context of a summary (`{summaryId, message}`)
- `GET /v1/chat/:id/events` — SSE stream of chat response tokens
- `GET /v1/chat/history?summaryId=X` — get chat history for a summary

### Cleanup

- Remove `/v1/processes`, `/v1/logs`, `/v1/tools`, `/v1/ping` — daemon-specific endpoints not needed on web server
- Remove `/v1/agent` — automation agent is browser-extension-specific (requires content script injection, debugger API). Chat covers the conversational use case.
- Remove `/v1/refresh-free` — free tier management, not applicable to central service

## Web Frontend: Preact + Vite Rebuild

### Tech Stack

- **Preact** (~3KB) — React-compatible component library, maximum LLM code generation reliability
- **Vite** — build tool with HMR for development
- **JSX/TSX** — standard React-style templates (not HTM)
- **TypeScript** — type safety
- **marked** + **DOMPurify** — markdown rendering (already in use)

### Architecture

New directory: **`apps/web/`** as a Vite project that builds to static assets served by the Hono server. This parallels the former `apps/chrome-extension/` structure and keeps frontend concerns out of the server source tree. Requires a `package.json` and pnpm workspace entry.

Components:

- `App` — root with simple hash-based routing
- `SummarizeView` — URL/text input, streaming output display
- `HistoryView` — paginated history list with search
- `SummaryDetail` — full summary with slides and chat
- `SlidesViewer` — grid/timeline of extracted slides with lightbox
- `ChatPanel` — follow-up questions on a summary, streaming responses
- `StreamingMarkdown` — progressive markdown rendering component
- `TokenInput` — auth token management
- `ThemeToggle` — light/dark/auto (existing feature)

### Key Behaviors

- **Streaming output:** Summary text renders token-by-token via SSE. Progress phases (extracting, transcribing, summarizing) shown as status indicators.
- **Slides viewer:** After video summary, "Extract slides" button triggers extraction. Progress streams in. Slides shown in a grid with timestamps; click to enlarge.
- **Chat:** Input below any completed summary. Responses stream in. History persisted per summary.
- **Responsive:** Works on mobile (future extension wrapper will load this).
- **Offline-safe:** Graceful degradation when server is unreachable.

### Build Integration

- Vite builds static assets to `apps/web/dist/`
- Hono server serves these statically in production (replacing current `src/server/public/`). Assets are baked into the Docker image at build time.
- Dev mode: Vite dev server on a separate port (e.g., 5173) with proxy config forwarding `/v1/*` to Hono on port 3000. This gives full HMR for the frontend while the API runs normally.
- Production build: `pnpm -C apps/web build` outputs to `apps/web/dist/`, Hono serves from there.

## Migration Strategy

1. **Relocate business logic** — move shared code out of `src/daemon/` to `packages/core/`, update **all** downstream imports (including `src/server/routes/summarize.ts` which currently imports from `../../daemon/summarize.js`), verify tests pass
2. **Add SSE streaming to web server** — enhance `POST /v1/summarize` with SSE support
3. **Add slides + chat endpoints** — new routes on the Hono server
4. **Build Preact frontend** — new Vite project, implement views incrementally (streaming first, then history, then slides, then chat)
5. **Delete extension + daemon** — remove all extension/daemon code, tests, and config
6. **Update deployment** — update Docker build, deployment docs, CLAUDE.md

Steps 1-4 can be done while the extension/daemon code still exists (no conflicts). Step 5 is a clean cut once the web version has feature parity.

## Out of Scope

- Agent/browser automation — inherently requires browser extension APIs (content scripts, debugger). Not portable to web.
- Hover tooltips — browser extension feature, no web equivalent.
- Custom skills / REPL — extension-specific automation features.
- Native app packaging — if ever needed, the web frontend works in Electron/Tauri.

## Future: Thin Chrome Extension

If a Chrome extension is wanted later, it would be:

- A manifest.json + sidepanel HTML that loads `summarize.p2lab.com` in a webview
- ~50 lines of code, not 17K
- The responsive Preact frontend works as-is
- Optional: content script for "summarize this page" context menu (extracts URL, opens sidepanel)
