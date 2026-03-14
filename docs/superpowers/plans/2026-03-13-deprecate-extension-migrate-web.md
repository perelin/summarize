# Deprecate Chrome Extension, Migrate Features to Web Server — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Chrome extension and daemon transport, relocate shared business logic to `packages/core/`, add SSE streaming + slides + chat to the web server, and rebuild the frontend with Preact + Vite.

**Architecture:** The daemon's business logic (`summarize.ts`, `chat.ts`, etc.) moves into `@steipete/summarize-core`. The Hono web server gains SSE streaming, slides, and chat endpoints. A new `apps/web/` Preact + Vite project replaces the vanilla JS frontend. The Chrome extension and daemon transport layer are deleted.

**Tech Stack:** TypeScript, Hono (API server), Preact + Vite (frontend), vitest (tests), SSE (streaming), SQLite (history/sessions), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-03-13-deprecate-extension-migrate-web-design.md`

---

## Chunk 1: Relocate Business Logic to packages/core/

Move shared daemon code into `@steipete/summarize-core` so the web server (and future consumers) import from core, not `src/daemon/`.

### Task 1.1: Move leaf utilities (meta.ts, summarize-progress.ts)

These have no daemon-internal dependencies, making them safe to move first.

**Files:**
- Move: `src/daemon/meta.ts` → `packages/core/src/summarize/meta.ts`
- Move: `src/daemon/summarize-progress.ts` → `packages/core/src/summarize/progress.ts`
- Create: `packages/core/src/summarize/index.ts` (barrel export)
- Modify: `packages/core/src/index.ts` (add re-export)
- Modify: `packages/core/package.json` (add `./summarize` export map entry)
- Update: `src/daemon/summarize.ts` imports
- Update: `tests/daemon.meta.test.ts` imports
- Update: `tests/daemon.summarize-progress.test.ts` imports

- [ ] **Step 1: Create `packages/core/src/summarize/` directory and barrel**

Create `packages/core/src/summarize/index.ts`:
```typescript
export { countWords, estimateDurationSecondsFromWords, formatInputSummary } from "./meta.js";
export type { InputSummaryArgs } from "./meta.js";
export { formatProgress } from "./progress.js";
```

- [ ] **Step 2: Copy `meta.ts` to new location**

Copy `src/daemon/meta.ts` → `packages/core/src/summarize/meta.ts`.
Update its import of `formatCompactCount`, `formatDurationSecondsSmart`, `formatMinutesSmart` from `../tty/format.js`. Since these are in the root package (`src/tty/format.ts`, ~74 LOC of pure formatting functions with zero dependencies), **move them to core** as `packages/core/src/shared/format.ts` and re-export via a `./format` export map entry. Then update `meta.ts` to import from `../shared/format.js`. Also update any root-package consumers of `src/tty/format.ts` to import from `@steipete/summarize-core/format`.

- [ ] **Step 3: Copy `summarize-progress.ts` to new location**

Copy `src/daemon/summarize-progress.ts` → `packages/core/src/summarize/progress.ts`.
Its only import is `@steipete/summarize-core/content` which already works from within core (change to relative `../content/index.js`).

- [ ] **Step 4: Add export map entry to `packages/core/package.json`**

Add to the `"exports"` field:
```json
"./summarize": {
  "types": "./dist/types/summarize/index.d.ts",
  "import": "./dist/esm/summarize/index.js"
}
```

- [ ] **Step 5: Re-export from `packages/core/src/index.ts`**

Add line: `export * from "./summarize/index.js";`

- [ ] **Step 6: Update imports in `src/daemon/summarize.ts`**

Change:
```typescript
import { countWords, estimateDurationSecondsFromWords, formatInputSummary } from "./meta.js";
import { formatProgress } from "./summarize-progress.js";
```
To:
```typescript
import { countWords, estimateDurationSecondsFromWords, formatInputSummary } from "@steipete/summarize-core/summarize";
import { formatProgress } from "@steipete/summarize-core/summarize";
```
(Or combine into one import.)

- [ ] **Step 7: Update test imports**

- `tests/daemon.meta.test.ts` — update import path to `@steipete/summarize-core/summarize`
- `tests/daemon.summarize-progress.test.ts` — update import path

- [ ] **Step 8: Delete original files**

Remove `src/daemon/meta.ts` and `src/daemon/summarize-progress.ts`.

- [ ] **Step 9: Build and test**

```bash
pnpm build && pnpm test
```
All tests must pass. Fix any broken imports.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/summarize/ packages/core/package.json packages/core/src/index.ts \
  src/daemon/summarize.ts tests/daemon.meta.test.ts tests/daemon.summarize-progress.test.ts
git commit -m "refactor: move meta.ts and summarize-progress.ts to packages/core"
```

---

### Task 1.2: Move flow-context.ts

This is the largest relocation (476 LOC) and has many imports from `src/run/`, `src/slides/`, etc.

**Files:**
- Move: `src/daemon/flow-context.ts` → `packages/core/src/summarize/flow-context.ts`
- Modify: `packages/core/src/summarize/index.ts` (add export)
- Modify: `src/daemon/summarize.ts` (update import)
- Update: test files that import flow-context

- [ ] **Step 1: Analyze `flow-context.ts` imports**

`flow-context.ts` imports heavily from `src/run/`, `src/slides/`, `src/cache.ts`, `src/config.ts`, `src/processes.ts`, `src/model-spec.ts`, `src/markitdown.ts`. These are all in the root package, not in `packages/core/`. Moving `flow-context.ts` to core means it would need to import back from the root package — creating a circular dependency (core depends on root, root depends on core).

**Decision point:** If circular dependency is unavoidable, `flow-context.ts` should stay in the root package (e.g., `src/summarize/flow-context.ts`) rather than moving to `packages/core/`. Assess at implementation time. The key goal is removing it from `src/daemon/`, not necessarily putting it in core.

- [ ] **Step 2: Move to appropriate location**

Based on Step 1 analysis:
- If no circular deps: move to `packages/core/src/summarize/flow-context.ts`
- If circular deps: move to `src/summarize/flow-context.ts` (new directory in root package)

Update the barrel export accordingly.

- [ ] **Step 3: Update `src/daemon/summarize.ts` import**

Change `import { createDaemonUrlFlowContext } from "./flow-context.js"` to the new path.

- [ ] **Step 4: Update tests**

Update imports in:
- `tests/daemon.flow-context.extract-only.test.ts`
- `tests/daemon.run-context-overrides.test.ts` (also imports from `../src/daemon/flow-context.js`)
- Any `tests/run.url-flow.*.test.ts` that reference flow-context

- [ ] **Step 5: Delete original, build, test**

```bash
rm src/daemon/flow-context.ts
pnpm build && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor: move flow-context.ts out of src/daemon/"
```

---

### Task 1.3: Move summarize.ts (core pipeline)

The main orchestrator. Depends on meta.ts and summarize-progress.ts (already moved) and flow-context.ts (moved in 1.2).

**Files:**
- Move: `src/daemon/summarize.ts` → `packages/core/src/summarize/pipeline.ts` (or `src/summarize/pipeline.ts` if circular deps)
- Modify: `packages/core/src/summarize/index.ts` (add exports)
- Modify: `src/server/routes/summarize.ts` (update imports — currently `../../daemon/summarize.js`)
- Update: `tests/server.summarize.test.ts`

- [ ] **Step 1: Move `summarize.ts` to new location**

Same circular-dependency consideration as flow-context.ts. This file imports from `src/cache.js`, `src/content/index.js`, `src/costs.js`, `src/run/...`, `src/slides/index.js`, and the now-relocated flow-context, meta, and progress modules.

- [ ] **Step 2: Update `src/server/routes/summarize.ts`**

Change:
```typescript
import {
  extractContentForUrl,
  streamSummaryForUrl,
  streamSummaryForVisiblePage,
} from "../../daemon/summarize.js";
import type { StreamSink } from "../../daemon/summarize.js";
```
To the new import path (either `@steipete/summarize-core/summarize` or `../../summarize/pipeline.js`).

- [ ] **Step 3: Update `src/daemon/server.ts`**

The daemon server also imports from `./summarize.ts`. Update to new path. (This file will be deleted later, but keep it working during migration.)

- [ ] **Step 4: Update tests**

Update these test files that import from `../src/daemon/summarize.js`:
- `tests/server.summarize.test.ts` — imports `* as summarizeMod`
- `tests/daemon.cache.summary.test.ts` — imports `streamSummaryForVisiblePage`

- [ ] **Step 5: Delete original, build, test**

```bash
rm src/daemon/summarize.ts
pnpm build && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor: move summarize pipeline out of src/daemon/"
```

---

### Task 1.4: Move chat.ts and models.ts

Both have no imports from *other daemon files*, but they do import heavily from root package modules (`src/llm/`, `src/model-auto.ts`, `src/run/env.js`, etc.), meaning they cannot go into `packages/core/` (circular dependency). They will move to `src/summarize/` in the root package.

**Files:**
- Move: `src/daemon/chat.ts` → `packages/core/src/summarize/chat.ts` (or `src/summarize/chat.ts`)
- Move: `src/daemon/models.ts` → `packages/core/src/summarize/models.ts` (or `src/summarize/models.ts`)
- Update: `src/daemon/server.ts` imports
- Update: `tests/daemon.chat.test.ts`, `tests/daemon.models.test.ts`

- [ ] **Step 1: Move `chat.ts`**

Note: `chat.ts` imports from `src/llm/`, `src/model-auto.ts`, `src/model-spec.ts`, `src/run/env.js`, `src/run/run-env.js` — same circular-dep consideration. It will likely need to stay in root package (`src/summarize/chat.ts`) rather than core.

Additionally, `chat.ts` uses a daemon-session-based context (`ChatSession` type). Add a TODO comment noting this needs adaptation for summaryId-based context when the chat endpoint is built (Task 3.2).

- [ ] **Step 2: Move `models.ts`**

Same circular-dep analysis. Imports `resolveCliAvailability` from `src/run/env.js` — add a TODO to remove CLI-local checks when adapting for web server.

- [ ] **Step 3: Update daemon server imports**

Update `src/daemon/server.ts` to import from new locations.

- [ ] **Step 4: Update tests, delete originals, build, test**

```bash
pnpm build && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: move chat.ts and models.ts out of src/daemon/"
```

---

### Task 1.5: Move SSE event types to packages/core/

**Files:**
- Move: `src/shared/sse-events.ts` → `packages/core/src/shared/sse-events.ts`
- Modify: `packages/core/package.json` (add `./sse` export map)
- Update: all consumers (grep for `shared/sse-events`)

**Cross-package dependency handling:** `sse-events.ts` has two imports that create issues when moving to core:
1. `AssistantMessage` from `@mariozechner/pi-ai` — used only by the `assistant` SSE event type, which is daemon/agent-specific. Since `agent.ts` is being deleted, **remove the `assistant` event type** from the SSE types during the move.
2. `PipelineReport` from `../run/run-metrics.js` — used by `SseMetricsData`. This is a type-only import. Either inline the relevant fields from `PipelineReport` into `SseMetricsData`, or move the `PipelineReport` type definition to core. Assess at implementation time; inlining is likely simpler.

- [ ] **Step 1: Copy and clean up the file**

Copy `src/shared/sse-events.ts` to `packages/core/src/shared/sse-events.ts`. Then:
- Remove the `assistant` event type and its `AssistantMessage` import
- Replace the `PipelineReport` import with an inline type or move the type to core

- [ ] **Step 2: Add export map entry**

```json
"./sse": {
  "types": "./dist/types/shared/sse-events.d.ts",
  "import": "./dist/esm/shared/sse-events.js"
}
```

- [ ] **Step 3: Update all imports**

Grep for `shared/sse-events` across the codebase and update to `@steipete/summarize-core/sse`.

- [ ] **Step 4: Delete original, build, test**

```bash
rm src/shared/sse-events.ts
pnpm build && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: move SSE event types to packages/core, remove agent-specific assistant event"
```

---

## Chunk 2: Add SSE Streaming to Web Server

### Task 2.1: Evolve SSE event schema

**Files:**
- Modify: `packages/core/src/shared/sse-events.ts` (add `summaryId` to `done`, add `code` to `error`)

**Note:** The `meta` event type already exists in the current SSE schema — no need to add it. The only actual schema changes needed are: (a) `done` payload gets `summaryId`, (b) `error` payload gets optional `code`.

- [ ] **Step 1: Write test for evolved SSE event types**

Create `tests/sse-events.test.ts`. The SSE event discriminant property is `event` (not `type`) — match the existing API:
```typescript
import { encodeSseEvent, parseSseEvent } from "@steipete/summarize-core/sse";

describe("SSE events - evolved schema", () => {
  it("encodes done event with summaryId", () => {
    const encoded = encodeSseEvent({ event: "done", data: { summaryId: "abc-123" } });
    expect(encoded).toContain("event: done");
    expect(encoded).toContain('"summaryId":"abc-123"');
  });

  it("encodes error event with code", () => {
    const encoded = encodeSseEvent({ event: "error", data: { code: "TIMEOUT", message: "Request timed out" } });
    expect(encoded).toContain('"code":"TIMEOUT"');
  });

  it("meta event already works (existing schema)", () => {
    const encoded = encodeSseEvent({ event: "meta", data: { title: "Test" } });
    expect(encoded).toContain("event: meta");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/sse-events.test.ts
```
Expected: FAIL on `done` test (current `done` data is `Record<string, never>`, doesn't accept `summaryId`). The `meta` test should already pass.

- [ ] **Step 3: Update SSE event types**

In `packages/core/src/shared/sse-events.ts`:
- `done` data: change from `Record<string, never>` to `{ summaryId: string }`
- `error` data: add optional `code?: string` alongside existing `message`

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm vitest run tests/sse-events.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: evolve SSE event schema — add summaryId to done, error code"
```

---

### Task 2.2: Add in-memory SSE session manager

**Files:**
- Create: `src/server/sse-session.ts`
- Create: `tests/server.sse-session.test.ts`

- [ ] **Step 1: Write tests for session manager**

Test: create session, push events, retrieve buffered events, TTL expiry, max buffer size.

- [ ] **Step 2: Run tests — expect fail**

- [ ] **Step 3: Implement session manager**

A `SseSessionManager` class that:
- Creates sessions with a unique ID
- Buffers SSE events per session (1MB cap, 15-min TTL)
- Supports `Last-Event-ID` for reconnection (events have sequential IDs)
- Periodic cleanup of expired sessions
- Methods: `createSession()`, `pushEvent(sessionId, event)`, `getEvents(sessionId, afterEventId?)`, `destroySession(sessionId)`

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add SSE session manager for streaming summarization"
```

---

### Task 2.3: Add SSE streaming to POST /v1/summarize

**Files:**
- Modify: `src/server/routes/summarize.ts`
- Modify: `src/server/index.ts` (wire up SSE GET endpoint)
- Create: `tests/server.sse-streaming.test.ts`

- [ ] **Step 1: Write integration test for SSE streaming**

Test: POST to `/v1/summarize` with `Accept: text/event-stream`, verify response is SSE stream with `chunk`, `status`, `done` events.

- [ ] **Step 2: Run test — expect fail**

- [ ] **Step 3: Implement SSE streaming path**

In `src/server/routes/summarize.ts`:
- Check `Accept` header for `text/event-stream`
- If SSE requested: create a session, pipe the `StreamSink` callbacks to SSE events, return streaming response
- If not: keep existing JSON response behavior
- Add `GET /v1/summarize/:id/events` for reconnection (reads from session buffer)

The `StreamSink` interface from `summarize.ts` already has callbacks for progress, chunks, and completion — map these to SSE events.

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Test manually**

```bash
curl -N -H "Authorization: Bearer <token>" -H "Accept: text/event-stream" \
  -X POST -d '{"url":"https://example.com"}' \
  http://localhost:3000/v1/summarize
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add SSE streaming support to POST /v1/summarize"
```

---

### Task 2.4: Add summaryId to JSON response

**Files:**
- Modify: `src/server/types.ts` (add `summaryId` to `SummarizeResponse`)
- Modify: `src/server/routes/summarize.ts` (include `summaryId` in JSON response)
- Update: `tests/server.summarize.test.ts`

- [ ] **Step 1: Update type and route**

Add `summaryId: string` to the `SummarizeResponse` type. Set it from the history record ID.

- [ ] **Step 2: Update tests, build, verify**

```bash
pnpm build && pnpm vitest run tests/server.summarize.test.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: include summaryId in summarize JSON response"
```

---

## Chunk 3: Add Slides + Chat Endpoints

### Task 3.1: Add slides endpoints

**Files:**
- Create: `src/server/routes/slides.ts`
- Modify: `src/server/index.ts` (register routes)
- Create: `tests/server.slides.test.ts`

- [ ] **Step 1: Write tests**

Test: POST to trigger slide extraction, GET SSE events for progress, GET slide image by sourceId/index.

- [ ] **Step 2: Run tests — expect fail**

- [ ] **Step 3: Implement slides routes**

```typescript
// src/server/routes/slides.ts
export function createSlidesRoute(deps: SlidesRouteDeps) {
  const app = new Hono();

  // POST /v1/summarize/:summaryId/slides — trigger extraction
  app.post("/v1/summarize/:summaryId/slides", async (c) => { ... });

  // GET /v1/summarize/:summaryId/slides/events — SSE stream of progress
  app.get("/v1/summarize/:summaryId/slides/events", async (c) => { ... });

  // GET /v1/slides/:sourceId/:index — serve slide image
  app.get("/v1/slides/:sourceId/:index", async (c) => { ... });

  return app;
}
```

Use `extractSlidesForSource` from `src/slides/index.ts`. Stream progress via SSE using the session manager from Task 2.2.

- [ ] **Step 4: Register routes in `src/server/index.ts`**

- [ ] **Step 5: Run tests — expect pass**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add slides extraction endpoints to web server"
```

---

### Task 3.2: Adapt chat.ts for summaryId-based context

**Files:**
- Modify: `src/summarize/chat.ts` (or wherever it landed in Task 1.4)
- Create: `tests/server.chat.test.ts`

- [ ] **Step 1: Write tests**

Test: `streamChatResponse` with a summaryId-based context (loads summary + metadata from history store, uses as chat context).

- [ ] **Step 2: Run tests — expect fail**

- [ ] **Step 3: Adapt chat.ts**

Replace the daemon `ChatSession` / `Session.lastMeta` context with a new interface:
```typescript
interface WebChatContext {
  summaryId: string;
  summary: string;
  metadata: SummarizeInsights;
  history: Message[];
}
```

Load context from the history store by summaryId. Feed the summary text + metadata as system context for the LLM.

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: adapt chat for summaryId-based context"
```

---

### Task 3.3: Add chat endpoints

**Files:**
- Create: `src/server/routes/chat.ts`
- Modify: `src/server/index.ts` (register routes)

- [ ] **Step 1: Write tests**

Test: POST `/v1/chat` with `{summaryId, message}` → SSE stream response. GET `/v1/chat/history?summaryId=X` → list of messages.

- [ ] **Step 2: Run tests — expect fail**

- [ ] **Step 3: Implement chat routes**

```typescript
// src/server/routes/chat.ts
export function createChatRoute(deps: ChatRouteDeps) {
  const app = new Hono();

  // POST /v1/chat — send message, stream response
  app.post("/v1/chat", async (c) => { ... });

  // GET /v1/chat/:id/events — SSE stream for a chat response
  app.get("/v1/chat/:id/events", async (c) => { ... });

  // GET /v1/chat/history — get chat history for a summary
  app.get("/v1/chat/history", async (c) => { ... });

  return app;
}
```

Chat history persisted in SQLite (add a `chat_messages` table to the existing history DB, or a separate `chat.db`).

- [ ] **Step 4: Register routes in `src/server/index.ts`**

- [ ] **Step 5: Run tests — expect pass**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add chat endpoints to web server"
```

---

## Chunk 4: Build Preact + Vite Frontend

### Task 4.1: Scaffold apps/web/

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app.tsx`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@steipete/summarize-web",
  "version": "0.13.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "preact": "^10.25.0",
    "marked": "^15.0.0",
    "dompurify": "^3.2.0"
  },
  "devDependencies": {
    "@preact/preset-vite": "^2.9.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create `vite.config.ts`**

```typescript
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: "dist",
    emptyDirOnBuild: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:3000",
    },
  },
});
```

- [ ] **Step 3: Create minimal `index.html` and `src/main.tsx`**

`index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Summarize</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

`src/main.tsx`:
```tsx
import { render } from "preact";
import { App } from "./app.tsx";
render(<App />, document.getElementById("app")!);
```

`src/app.tsx`:
```tsx
export function App() {
  return <div>Summarize</div>;
}
```

- [ ] **Step 4: Install dependencies and verify dev server starts**

```bash
pnpm install && pnpm -C apps/web dev
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: scaffold Preact + Vite frontend in apps/web"
```

---

### Task 4.2: Build SummarizeView with streaming

**Files:**
- Create: `apps/web/src/components/summarize-view.tsx`
- Create: `apps/web/src/lib/api.ts` (API client with SSE support)
- Create: `apps/web/src/lib/use-sse.ts` (SSE hook)
- Create: `apps/web/src/components/streaming-markdown.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Build API client**

`src/lib/api.ts` — functions for calling `/v1/summarize` (both JSON and SSE modes), `/v1/me`, etc. Token management (localStorage).

- [ ] **Step 2: Build SSE hook**

`src/lib/use-sse.ts` — a Preact hook that wraps `EventSource` / `fetch` with SSE parsing, handles reconnection, exposes state (connecting/streaming/done/error).

- [ ] **Step 3: Build StreamingMarkdown component**

Renders markdown incrementally as text arrives. Uses `marked` for parsing, `DOMPurify` for sanitization.

- [ ] **Step 4: Build SummarizeView**

URL/text input form. On submit, calls API with SSE. Shows progress phases (`status` events), then streaming summary (`chunk` events). Final state shows complete summary.

- [ ] **Step 5: Wire into App with basic routing**

Hash-based routing: `#/` → SummarizeView, `#/history` → placeholder, `#/summary/:id` → placeholder.

- [ ] **Step 6: Test manually**

Start Vite dev server + Hono API, submit a URL, verify streaming works.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: add SummarizeView with SSE streaming to web frontend"
```

---

### Task 4.3: Build HistoryView

**Files:**
- Create: `apps/web/src/components/history-view.tsx`
- Create: `apps/web/src/components/history-item.tsx`

- [ ] **Step 1: Build HistoryView**

Paginated list from `GET /v1/history`. Each item shows title, URL, date, summary preview. Click navigates to `#/summary/:id`.

- [ ] **Step 2: Build SummaryDetail view**

Route `#/summary/:id` loads `GET /v1/history/:id`, shows full summary with markdown rendering. If source is video, show "Extract slides" button. Show chat panel below.

- [ ] **Step 3: Test manually, commit**

```bash
git commit -m "feat: add HistoryView and SummaryDetail to web frontend"
```

---

### Task 4.4: Build SlidesViewer

**Files:**
- Create: `apps/web/src/components/slides-viewer.tsx`
- Create: `apps/web/src/components/slide-card.tsx`

- [ ] **Step 1: Build SlidesViewer**

"Extract slides" button triggers `POST /v1/summarize/:summaryId/slides`. Progress streams in via SSE. Once complete, show slides in a grid. Each card shows slide image + timestamp. Click to enlarge (lightbox/modal).

- [ ] **Step 2: Test manually with a YouTube video, commit**

```bash
git commit -m "feat: add SlidesViewer to web frontend"
```

---

### Task 4.5: Build ChatPanel

**Files:**
- Create: `apps/web/src/components/chat-panel.tsx`
- Create: `apps/web/src/components/chat-message.tsx`

- [ ] **Step 1: Build ChatPanel**

Input below summary. On submit, calls `POST /v1/chat` with summaryId + message. Response streams in via SSE. Chat history loaded from `GET /v1/chat/history?summaryId=X`. Messages rendered with markdown.

- [ ] **Step 2: Test manually, commit**

```bash
git commit -m "feat: add ChatPanel to web frontend"
```

---

### Task 4.6: Add TokenInput and ThemeToggle

**Files:**
- Create: `apps/web/src/components/token-input.tsx`
- Create: `apps/web/src/components/theme-toggle.tsx`
- Create: `apps/web/src/lib/theme.ts`

- [ ] **Step 1: Build TokenInput**

If no token in localStorage, show auth screen. Support `?token=X` URL param for initial setup. Validate with `GET /v1/me`.

- [ ] **Step 2: Build ThemeToggle**

Light/dark/auto toggle. Persist preference in localStorage. Apply via CSS custom properties.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add token auth and theme toggle to web frontend"
```

---

### Task 4.7: Wire Hono to serve built frontend

**Files:**
- Modify: `src/server/index.ts` (serve from `apps/web/dist/` instead of `src/server/public/`)
- Modify: root `package.json` (update `build:lib` to include frontend build)
- Modify: `Dockerfile` (build frontend in builder stage)

- [ ] **Step 1: Update build scripts to copy frontend assets**

In root `package.json`, update the `build:lib` script: replace the current `cp -r src/server/public dist/esm/server/public` with `cp -r apps/web/dist dist/esm/server/public`. Add `pnpm -C apps/web build` to the build chain (after core, before `build:lib`).

This keeps the same serving approach: Hono reads from `dist/esm/server/public/` (via `__dirname` resolution), and the build step populates it from the Vite output.

- [ ] **Step 2: Update Hono static file serving (if needed)**

The path resolution in `src/server/index.ts` should still work since assets end up in the same relative location (`dist/esm/server/public/`). Verify this. In dev mode (`SUMMARIZE_DEV=1`), the existing hot-reload behavior should work since files are read from disk on each request.

- [ ] **Step 3: Update Dockerfile**

In the builder stage:
- Add `COPY apps/web/ ./apps/web/` to ensure the frontend source is available
- After `pnpm build` (which now includes the frontend build), verify `dist/esm/server/public/` contains the built assets
- No additional runtime-stage changes needed since assets are baked into `dist/`

- [ ] **Step 4: Test production build locally**

```bash
pnpm build && node dist/esm/server/main.js
```
Verify `http://localhost:3000` serves the Preact frontend.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: serve Preact frontend from Hono server"
```

---

## Chunk 5: Delete Extension + Daemon, Update Deployment

### Task 5.1: Delete Chrome extension

**Files:**
- Delete: `apps/chrome-extension/` (entire directory)

- [ ] **Step 1: Remove the directory**

```bash
rm -rf apps/chrome-extension
```

- [ ] **Step 2: Remove any references**

Grep for `chrome-extension` in root `package.json` scripts, `pnpm-workspace.yaml`, CLAUDE.md, and other config files. Remove or update references.

- [ ] **Step 3: Build and test**

```bash
pnpm build && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove Chrome extension"
```

---

### Task 5.2: Delete daemon transport layer

**Files:**
- Delete: `src/daemon/server.ts`, `server-http.ts`, `server-session.ts`
- Delete: `src/daemon/cli.ts`, `cli-entrypoint.ts`
- Delete: `src/daemon/launchd.ts`, `systemd.ts`, `schtasks.ts`
- Delete: `src/daemon/config.ts`, `constants.ts`
- Delete: `src/daemon/env-snapshot.ts`, `env-merge.ts`
- Delete: `src/daemon/process-registry.ts`
- Delete: `src/daemon/agent.ts`
- Delete: `src/daemon/auto-mode.ts`
- Delete: any remaining files in `src/daemon/` that weren't relocated
- Modify: `src/logging/daemon.ts` — imports `resolveDaemonLogPaths` from `../daemon/launchd.js`; delete or refactor

- [ ] **Step 1: Delete daemon files**

Remove all files listed above. If `src/daemon/` is now empty, remove the directory.

- [ ] **Step 2: Clean up CLI references and daemon logging**

- In `src/run/cli-preflight.ts` (or wherever daemon CLI commands are registered), remove `handleDaemonRequest` import and the `daemon` subcommand handler.
- Update or delete `src/logging/daemon.ts` which imports from `../daemon/launchd.js` — this is daemon-specific logging infrastructure that should be removed.

- [ ] **Step 3: Remove daemon test files**

Delete all `tests/daemon.*.test.ts` files and `tests/chrome.daemon-*.test.ts` files.

- [ ] **Step 4: Build and test**

```bash
pnpm build && pnpm test
```

Fix any remaining broken imports.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove daemon transport layer and related tests"
```

---

### Task 5.3: Clean up old frontend

**Files:**
- Delete: `src/server/public/` (replaced by `apps/web/dist/`)

- [ ] **Step 1: Remove old frontend**

```bash
rm -rf src/server/public
```

- [ ] **Step 2: Update `build:lib` script**

In root `package.json`, remove the `cp -r src/server/public dist/esm/server/public` from the `build:lib` script.

- [ ] **Step 3: Build and test**

```bash
pnpm build && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove old vanilla JS frontend"
```

---

### Task 5.4: Update deployment and docs

**Files:**
- Modify: `Dockerfile`
- Modify: `CLAUDE.md`
- Modify: `docs/deployment.md` (if exists)
- Modify: `docs/api-server.md` (if exists)

- [ ] **Step 1: Update Dockerfile**

Ensure the build step includes `pnpm -C apps/web build` and the runtime copies the correct assets. Remove any daemon-related artifacts.

- [ ] **Step 2: Update CLAUDE.md**

Remove references to:
- Chrome extension build/test commands
- `apps/chrome-extension/`
- Daemon restart/status commands
- Extension test commands (Firefox, Chrome)

Add references to:
- `apps/web/` frontend
- `pnpm -C apps/web dev` for frontend development
- New SSE streaming, slides, and chat endpoints

- [ ] **Step 3: Update other docs**

Update `docs/api-server.md` with new endpoints. Update `docs/deployment.md` if it references daemon or extension.

- [ ] **Step 4: Build, test, verify deployment**

```bash
pnpm build && pnpm test
```

Deploy to staging if available: rebuild Docker image, push, verify.

- [ ] **Step 5: Commit**

```bash
git commit -m "docs: update deployment and project docs for web-only architecture"
```

---

## Task Dependencies

```
Chunk 1 (relocate): 1.1 → 1.2 → 1.3 → 1.4 → 1.5 (sequential — each depends on prior moves)
Chunk 2 (SSE): 2.1 → 2.2 → 2.3 → 2.4 (sequential — builds on prior infrastructure)
Chunk 3 (slides+chat): 3.1, 3.2 → 3.3 (slides and chat adaptation can parallel, chat endpoint needs 3.2)
Chunk 4 (frontend): 4.1 → 4.2 → 4.3, 4.4, 4.5, 4.6 → 4.7 (scaffold first, then views can parallel, wire up last)
Chunk 5 (cleanup): 5.1, 5.2 → 5.3 → 5.4 (extension and daemon can parallel, then cleanup, then docs)

Cross-chunk: Chunk 1 must complete before Chunk 2. Chunk 3 requires Chunk 1 + Task 2.2 (SSE session manager), but NOT Tasks 2.3/2.4 — so Chunk 3 can begin once Task 2.2 is done, in parallel with Tasks 2.3/2.4. Chunks 2+3 must complete before Chunk 4 (frontend needs working endpoints). Chunks 1-4 before Chunk 5.

Note: `pnpm-workspace.yaml` already includes `apps/*`, so `apps/web/` will be auto-discovered — no workspace config changes needed.
```
