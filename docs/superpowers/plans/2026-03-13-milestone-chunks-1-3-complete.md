# Milestone: Chunks 1-3 Complete — Handoff Document

**Date:** 2026-03-13
**Branch:** `feature/deprecate-extension-migrate-web`
**Worktree:** `.worktrees/deprecate-extension/`
**Base commit:** `a7b57f8` (main)
**Head commit:** `7594fd8`
**Tests:** 1538 passed, 0 failures (up from 1464 — 74 new tests added)

## What's Done (Chunks 1-3)

### Chunk 1: Business Logic Relocation (5 tasks, 5 commits)

All shared business logic moved out of `src/daemon/`:

| File | From | To |
|------|------|----|
| `format.ts` | `src/tty/` | `packages/core/src/shared/format.ts` (`@steipete/summarize-core/format`) |
| `meta.ts` | `src/daemon/` | `packages/core/src/summarize/meta.ts` (`@steipete/summarize-core/summarize`) |
| `summarize-progress.ts` | `src/daemon/` | `packages/core/src/summarize/progress.ts` (`@steipete/summarize-core/summarize`) |
| `sse-events.ts` | `src/shared/` | `packages/core/src/shared/sse-events.ts` (`@steipete/summarize-core/sse`) |
| `flow-context.ts` | `src/daemon/` | `src/summarize/flow-context.ts` (root pkg — circular deps) |
| `summarize.ts` | `src/daemon/` | `src/summarize/pipeline.ts` (root pkg — circular deps) |
| `chat.ts` | `src/daemon/` | `src/summarize/chat.ts` (root pkg — circular deps) |
| `models.ts` | `src/daemon/` | `src/summarize/models.ts` (root pkg — circular deps) |

**Decision:** Files with root-package dependencies (`src/run/`, `src/llm/`, etc.) stayed in root at `src/summarize/`. Only pure utilities moved to `packages/core/`.

### Chunk 2: SSE Streaming for Web Server (4 tasks, 4 commits)

- SSE event schema evolved: `done` event now includes `summaryId`, `error` gets optional `code`
- `SseSessionManager` created: in-memory buffering, 15-min TTL, 1MB cap, Last-Event-ID reconnection
- `POST /v1/summarize` now supports `Accept: text/event-stream` opt-in (JSON remains default)
- `GET /v1/summarize/:id/events` for SSE reconnection
- `summaryId` included in both SSE `done` event and JSON response

### Chunk 3: Slides + Chat Endpoints (3 tasks, 2 commits)

**Slides:**
- `POST /v1/summarize/:summaryId/slides` — triggers extraction, returns sessionId
- `GET /v1/summarize/:summaryId/slides/events?sessionId=X` — SSE progress
- `GET /v1/slides/:sourceId/:index` — serves slide images with caching

**Chat:**
- `POST /v1/chat` — streams LLM response grounded in summary context
- `GET /v1/chat/:id/events` — SSE reconnection
- `GET /v1/chat/history?summaryId=X` — chat message history
- `ChatStore` (SQLite) at `~/.summarize/chat.sqlite`
- `WebChatContext` + `streamWebChatResponse()` in `src/summarize/chat.ts`

## What Remains (Chunks 4-5)

### Chunk 4: Preact + Vite Frontend (7 tasks)

See plan: `docs/superpowers/plans/2026-03-13-deprecate-extension-migrate-web.md`, Tasks 4.1-4.7

| Task | Description | Status |
|------|-------------|--------|
| 4.1 | Scaffold `apps/web/` (Preact + Vite + TypeScript) | pending |
| 4.2 | SummarizeView with SSE streaming | pending |
| 4.3 | HistoryView + SummaryDetail | pending |
| 4.4 | SlidesViewer | pending |
| 4.5 | ChatPanel | pending |
| 4.6 | TokenInput + ThemeToggle | pending |
| 4.7 | Wire Hono to serve built frontend + Dockerfile | pending |

**Key decisions already made:**
- Directory: `apps/web/` (parallels former `apps/chrome-extension/`)
- Tech: Preact + Vite + JSX/TSX (not HTM)
- Dependencies: `preact`, `marked`, `dompurify`, `@preact/preset-vite`, `vite`, `typescript`
- Dev mode: Vite on port 5173 with proxy to Hono on 3000
- Production: Vite builds to `apps/web/dist/`, copied to `dist/esm/server/public/` during build
- Routing: hash-based (`#/`, `#/history`, `#/summary/:id`)

### Chunk 5: Delete Extension + Daemon (4 tasks)

| Task | Description | Status |
|------|-------------|--------|
| 5.1 | Delete `apps/chrome-extension/` | pending |
| 5.2 | Delete daemon transport (server.ts, CLI, launchd, etc.) + `src/logging/daemon.ts` | pending |
| 5.3 | Delete old frontend (`src/server/public/`) | pending |
| 5.4 | Update Dockerfile, CLAUDE.md, deployment docs | pending |

## Key Files for Next Agent

**Plans and specs:**
- `docs/superpowers/plans/2026-03-13-deprecate-extension-migrate-web.md` — full implementation plan
- `docs/superpowers/specs/2026-03-13-deprecate-extension-migrate-web-design.md` — design spec

**New server code (Chunk 2-3 additions):**
- `src/server/sse-session.ts` — SSE session manager
- `src/server/routes/summarize.ts` — enhanced with SSE streaming
- `src/server/routes/slides.ts` — new slides endpoints
- `src/server/routes/chat.ts` — new chat endpoints
- `src/chat-store.ts` — SQLite chat persistence
- `src/summarize/chat.ts` — `streamWebChatResponse()` (new web-compatible function)

**Relocated business logic:**
- `src/summarize/pipeline.ts` — core summarization (was `src/daemon/summarize.ts`)
- `src/summarize/flow-context.ts` — URL flow context
- `src/summarize/chat.ts` — chat logic
- `src/summarize/models.ts` — model selection
- `packages/core/src/summarize/` — meta, progress utilities
- `packages/core/src/shared/format.ts` — formatting utilities
- `packages/core/src/shared/sse-events.ts` — SSE event types

**What's still in `src/daemon/` (to be deleted in Chunk 5):**
- `server.ts`, `server-http.ts`, `server-session.ts` — daemon HTTP transport
- `cli.ts`, `cli-entrypoint.ts` — daemon CLI commands
- `launchd.ts`, `systemd.ts`, `schtasks.ts` — platform service managers
- `config.ts`, `constants.ts` — daemon config
- `env-snapshot.ts`, `env-merge.ts` — env capture
- `process-registry.ts` — process tracking
- `agent.ts` — browser automation agent
- `auto-mode.ts` — auto mode detection

## How to Resume

```bash
cd /Users/sebastianpatinolang/code/p2lab/summarize/.worktrees/deprecate-extension
git log --oneline -3  # verify you're on feature/deprecate-extension-migrate-web
pnpm build && pnpm vitest run  # verify clean baseline
```

Then follow the plan starting at Task 4.1.
