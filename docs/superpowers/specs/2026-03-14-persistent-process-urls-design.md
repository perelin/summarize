# Persistent Process URLs — Design Spec

**Date:** 2026-03-14
**Status:** Draft

## Problem

When a user submits a URL for summarization, the browser URL stays on `/` (or `#/`) throughout the streaming process. Refreshing the page loses all state. There is no way to share a link to an in-progress or completed summary directly.

## Goals

1. **Canonical URL from the start**: When a summarization process begins, the browser URL updates to `/s/{summaryId}` immediately.
2. **Reload resilience**: Refreshing `/s/{id}` reconnects to the SSE stream and shows buffered content plus live streaming.
3. **Shareability**: The URL can be shared; recipients see the same content (in-progress or completed).
4. **Bookmarkability**: `/s/{id}` is a permanent link — it works during processing and after completion.
5. **Single URL lifecycle**: The URL never changes between in-progress and completed states — the UI adapts.

## Decisions Made

| Decision           | Choice                                     | Rationale                                       |
| ------------------ | ------------------------------------------ | ----------------------------------------------- |
| URL structure      | Path-based (`/s/{id}`)                     | Modern, server can add OG tags later, clean     |
| Routing migration  | Full path-based with hash compat redirect  | Clean architecture + backward compatibility     |
| ID delivery        | New `init` SSE event as first event        | Explicit, clean protocol, minimal server change |
| Reconnection UX    | Show buffered content + resume live stream | Best UX, infrastructure already exists          |
| Missing/expired ID | 404 page with context                      | Honest and helpful                              |
| Back navigation    | Fresh form                                 | Simple, no state management needed              |

## Architecture

### Current State

- **Router**: Custom hash-based (`#/`, `#/history`, `#/summary/:id`) in `apps/web/src/lib/router.ts`
- **IDs**: Server generates both `summaryId` (history row UUID) and `sessionId` (SSE buffer UUID) at stream start. Client only receives `summaryId` in the final `done` event.
- **SSE session manager**: Buffers events in memory (15min TTL, 1MB cap). Reconnection endpoint exists at `GET /v1/summarize/:sessionId/events` but the client never uses it.
- **Static serving**: Only `GET /` serves `index.html` — no SPA catch-all.

### Key Insight: Unify summaryId and sessionId

Currently two separate UUIDs exist for no good reason. The `summaryId` is used for the history row; `sessionId` is used for SSE buffering. Unifying them simplifies everything:

- One ID to rule them all: the `summaryId` serves as both the history row key AND the SSE session key
- The `init` event sends `summaryId` to the client
- Reconnection uses `GET /v1/summarize/:summaryId/events`
- The URL is `/s/{summaryId}`
- After completion, `/s/{summaryId}` loads from the history DB

### Proposed Changes

#### 1. Server: Unify IDs and add `init` event

**File: `src/server/routes/summarize.ts`**

- Use `summaryId` as the session ID: `sessionManager.createSession(summaryId)` instead of generating a separate `sessionId`
- Emit a new `init` SSE event as the very first event:
  ```
  event: init
  data: {"summaryId":"<uuid>"}
  ```
- The reconnection endpoint (`GET /v1/summarize/:id/events`) already accepts `:id` — it now matches `summaryId` directly.

**File: `src/server/sse-session.ts`**

- Modify `createSession()` to accept an optional `id` parameter instead of always generating one:

  ```ts
  createSession(id?: string): string
  ```

- Add a subscriber/notification mechanism for live event forwarding. The current implementation is replay-only: `getEvents()` returns buffered events and the connection closes. For reconnection to work with in-progress streams, subscribers need to receive new events as they arrive:

  ```ts
  // New API additions:
  subscribe(sessionId: string, callback: (event: SseEvent) => void): () => void
  // Returns an unsubscribe function. callback is invoked for each new event
  // pushed after subscription. The subscriber ALSO receives the replay of
  // buffered events (via getEvents) before live forwarding begins.

  isActive(sessionId: string): boolean
  // Returns true if the session exists and has not received a "done" or "error" event.
  // Used by ProcessView to decide whether to subscribe or load from history.

  markComplete(sessionId: string): void
  // Called after the "done" event is pushed. Sets a flag so isActive() returns false.
  // The session remains in the buffer for the normal TTL (for late reconnectors).
  ```

- Implementation: `pushEvent()` iterates over registered subscribers and calls each callback. Subscribers are stored as a `Map<string, Set<callback>>` on the session manager. Unsubscribe removes the callback from the set.

- This is a lightweight pub/sub — no external dependencies, ~30 lines of code. The session manager already owns the event lifecycle, so this is a natural extension.

#### 2. Server: SPA catch-all route

**File: `src/server/index.ts`**

Add a catch-all route after all other routes that serves `index.html` for any path not matching `/v1/*`, `/assets/*`, or known static files. This enables path-based routing — the browser can load `/s/abc123` and receive the SPA.

```
GET * → serve index.html (if not API or asset)
```

Order matters: register this AFTER all API routes and static file routes.

#### 3. Client: Path-based router

**File: `apps/web/src/lib/router.ts`**

Replace hash-based routing with `history.pushState`/`popstate`-based routing:

```ts
type Route = { view: "summarize" } | { view: "history" } | { view: "summary"; id: string };

// Parse window.location.pathname:
// "/" → { view: "summarize" }
// "/history" → { view: "history" }
// "/s/:id" → { view: "summary", id }
// anything else → { view: "summarize" }
```

**Navigation function**: `navigate(path)` calls `history.pushState({}, "", path)` and dispatches a custom `"navigate"` event so all `useRoute()` hooks re-render.

**Link interception**: Export a `Link` component (or an `onClick` handler utility) that prevents default `<a>` behavior and calls `navigate()` instead. All internal links in `app.tsx`, `history-view.tsx`, `summary-detail.tsx`, etc. must use this instead of raw `<a href="...">` to avoid full-page reloads. Example:

```tsx
export function Link({ href, children, ...props }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        navigate(href);
      }}
      {...props}
    >
      {children}
    </a>
  );
}
```

**Hash compatibility layer**: On app load, check `window.location.hash`:

- `#/summary/:id` → `history.replaceState` to `/s/:id`
- `#/history` → `history.replaceState` to `/history`
- `#/` or empty → no-op (already on `/`)

This is a one-time redirect on page load, ~10 lines.

#### 4. Client: `init` event handling in `summarizeSSE()`

**File: `apps/web/src/lib/api.ts`**

Add an `onInit` callback to the SSE handler:

```ts
interface SummarizeCallbacks {
  onInit?: (summaryId: string) => void;  // NEW
  onStatus?: (text: string) => void;
  onChunk?: (text: string) => void;
  onMeta?: (...) => void;
  onDone?: (summaryId: string) => void;
  onError?: (message: string) => void;
  onMetrics?: (...) => void;
}
```

Parse the new `init` event type and call `onInit(data.summaryId)`.

#### 5. Client: URL update on submit

**File: `apps/web/src/components/summarize-view.tsx`**

In `handleSubmit`, wire the new `onInit` callback:

```ts
onInit(summaryId) {
  setSummaryId(summaryId);
  navigate(`/s/${summaryId}`);  // URL updates immediately
}
```

This means: user clicks Submit → SSE stream opens → first event is `init` with the ID → URL changes to `/s/{summaryId}` within milliseconds.

#### 6. Client: Reconnection on page load

**File: `apps/web/src/components/summarize-view.tsx`** (or a new route handler)

When the app loads at `/s/{id}`:

1. **Check if process is active**: `GET /v1/summarize/:id/events` — this endpoint is auth-protected (same `authHeaders()` pattern as other API calls). The request must include the auth token.
2. **If active** (200 response): The server replays all buffered events, then holds the SSE connection open. New events are forwarded in real-time via the subscriber mechanism added to `SseSessionManager`. The client reconstructs `chunks` from buffered `chunk` events, shows the latest `status`, and then continues receiving live `chunk`/`status`/`done` events through the same connection.
3. **If not active** (404 response): Load from history via `GET /v1/history/:id`. If found, render as completed summary (same as current `SummaryDetail`). If not found, show 404 page.

This creates a unified view: `/s/{id}` shows either the live stream or the completed result, adapting automatically.

**Reconnection endpoint changes** (`GET /v1/summarize/:id/events`): Currently this endpoint streams buffered events and closes. It must be updated to:

1. Stream all buffered events (with `Last-Event-ID` filtering as before)
2. If the session is still active (`isActive(id)` returns true), hold the connection open and subscribe to new events via `subscribe(id, callback)`. Each new event is written to the response as an SSE message.
3. Unsubscribe when the client disconnects (response `close` event) or when a `done`/`error` event is forwarded.

#### 7. View unification

Currently `SummarizeView` handles streaming and `SummaryDetail` handles completed summaries. With persistent URLs, `/s/{id}` needs to handle both states. Two options:

**Chosen approach**: Create a new `ProcessView` component mounted at the `/s/:id` route that:

- On mount, probes the SSE reconnection endpoint
- If active: renders the streaming UI (similar to `SummarizeView`'s streaming state)
- If completed: renders the summary detail (delegates to `SummaryDetail` or reuses its internals)
- If not found: renders the 404 page

This keeps `SummarizeView` focused on the form/submit flow and `ProcessView` focused on displaying a process by ID. After `SummarizeView` receives the `init` event and navigates to `/s/{id}`, `ProcessView` takes over.

**State handoff concern**: When `SummarizeView` navigates to `/s/{id}`, the SSE stream is already open in `SummarizeView`. We don't want to close it and reopen. Options:

- **Transfer the SSE connection**: Pass the `AbortController` and accumulated state to `ProcessView` via a shared context/signal. Complex.
- **Keep SummarizeView mounted**: The current architecture already keeps `SummarizeView` mounted (hidden). After navigation, `ProcessView` could check if `SummarizeView` already has this stream active and simply not reconnect. But this couples the two.
- **Close and reconnect** (recommended): When navigating to `/s/{id}`, abort the SSE in `SummarizeView` and let `ProcessView` reconnect via the reconnection endpoint. The endpoint replays buffered events (so no content is lost) and then subscribes to live updates (so no events are missed). The latency is negligible (local reconnect). This is the simplest approach and avoids coupling between `SummarizeView` and `ProcessView`.

#### 8. Route table update

**File: `apps/web/src/app.tsx`**

```tsx
// Old:
route.view === "summarize" → <SummarizeView />
route.view === "history" → <HistoryView />
route.view === "summary" → <SummaryDetail id={route.id} />

// New:
route.view === "summarize" → <SummarizeView />
route.view === "history" → <HistoryView />
route.view === "summary" → <ProcessView id={route.id} />
```

Note: `SummarizeView` no longer needs to be always-mounted. It can be conditionally rendered like the others, since streaming state is now recoverable via SSE reconnection.

#### 9. 404 page

**New file: `apps/web/src/components/not-found-view.tsx`**

Simple component:

- "Summary not found"
- "This summary may have expired or the link may be incorrect."
- Link back to home page

### Data Flow

```
Submit flow:
  User fills form on "/" → clicks Submit
  → POST /v1/summarize (SSE)
  → Server: generates summaryId, creates SSE session with same ID
  → Server: emits init event { summaryId }
  → Client: receives init → history.pushState("/s/{summaryId}")
  → Client: continues receiving status/chunk/done events
  → Server: emits done → inserts history row
  → Client: receives done → UI transitions to completed state

Reload/share flow:
  Browser loads "/s/{summaryId}"
  → Server: SPA catch-all serves index.html
  → Client: router parses → { view: "summary", id: summaryId }
  → Client: mounts ProcessView
  → ProcessView: GET /v1/summarize/{summaryId}/events
    → If 200: replay buffered events, continue streaming
    → If 404: GET /v1/history/{summaryId}
      → If 200: render completed summary
      → If 404: render NotFoundView

Hash compat:
  Browser loads "/#/summary/{id}"
  → Client: on load, detects hash route
  → Client: history.replaceState("/s/{id}")
  → Normal path-based routing takes over
```

### Edge Cases

1. **SSE buffer expired but history exists**: Process took > 15 min but completed. Reconnection endpoint returns 404, but history endpoint returns the completed summary. Works correctly.

2. **SSE buffer expired and process still running**: Unlikely (15min TTL vs typical 1-5min process), but if it happens, the user sees the 404 page. Acceptable — we could extend TTL if this becomes an issue.

3. **Multiple tabs**: User opens `/s/{id}` in two tabs during streaming. Both connect to the same SSE session buffer. Both receive events. Works correctly — SSE sessions are read-only from the client perspective.

4. **Browser back after submit**: User submits → URL changes to `/s/{id}` → user clicks Back → goes to `/` with fresh form. `ProcessView` unmounts, SSE connection closes. The process continues server-side (fire-and-forget history insertion). If the user navigates forward or re-visits `/s/{id}`, they reconnect.

5. **Submit while viewing another process**: User is on `/s/abc` viewing a completed summary, navigates to `/`, submits a new URL. New process gets new ID, URL updates to `/s/def`. No conflict.

### Files Changed

| File                                         | Change                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/server/sse-session.ts`                  | Accept optional ID, add subscribe/isActive/markComplete                                              |
| `src/server/routes/summarize.ts`             | Unify IDs, emit `init` event, call `markComplete` on done                                            |
| `src/server/routes/summarize.ts`             | Update reconnection endpoint to hold connection + subscribe                                          |
| `src/server/index.ts`                        | Add SPA catch-all route                                                                              |
| `apps/web/src/lib/router.ts`                 | Path-based routing, `Link` component, hash compat                                                    |
| `apps/web/src/lib/api.ts`                    | Add `onInit` callback, parse `init` event                                                            |
| `apps/web/src/components/summarize-view.tsx` | Wire `onInit`, navigate on init, remove "View details" button (redundant — URL is already `/s/{id}`) |
| `apps/web/src/components/process-view.tsx`   | **NEW** — unified streaming/completed view                                                           |
| `apps/web/src/components/not-found-view.tsx` | **NEW** — 404 page                                                                                   |
| `apps/web/src/components/history-view.tsx`   | Update links from `#/summary/:id` to `/s/:id` via `Link`                                             |
| `apps/web/src/components/summary-detail.tsx` | Update back/delete navigation to use `navigate()`                                                    |
| `apps/web/src/app.tsx`                       | Update route table, use `Link` for nav, remove always-mounted pattern                                |
| `apps/web/vite.config.ts`                    | Verify/add `historyApiFallback` for dev server (Vite SPA mode)                                       |

### Testing Strategy

1. **Unit tests**: Router parsing (path → Route), hash compat redirects
2. **Server tests**: `init` event emission, unified session ID, SPA catch-all
3. **Integration tests**: Full submit flow → URL update → reload → reconnect
4. **Manual tests**: Share URL between browsers, browser back/forward, expired sessions

### Dev Server Note

Vite's default `appType: 'spa'` serves `index.html` for all non-asset paths in dev mode. Verify this works in `apps/web/vite.config.ts`. The existing proxy config (`/v1` → API server) should continue to work alongside the SPA fallback since proxied paths take precedence.

### Out of Scope

- OG meta tags / link previews (future enhancement once path routing is in place)
- Form state preservation on back navigation
- Process progress percentage (current status messages are text-only)
- Multiple concurrent processes per user
- Subpath deployment (app assumed to be served at root `/`)
