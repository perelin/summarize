# Code Review Cleanup — Tiers 3-4

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all Tier 3 (DRY, YAGNI, KISS, server bugs, frontend bugs) and Tier 4 (test health) findings from the 2026-03-14 code review.

**Architecture:** Incremental cleanup — each chunk is independently committable. No new features, only deduplication, dead code removal, bug fixes, and test improvements.

**Tech Stack:** TypeScript, Preact, Hono, Vitest

**Test command:** `pnpm vitest run`
**Lint command:** `pnpm lint`
**Build command:** `pnpm build`
**Frontend build:** `pnpm -C apps/web build`

---

## Chunk 1: YAGNI — Dead Code Removal (quick wins)

These are safe, isolated deletions with no behavioral change.

### Task 1.1: Remove unused `streaming` prop from StreamingMarkdown

**Files:**
- Modify: `apps/web/src/components/streaming-markdown.tsx`
- Modify: `apps/web/src/components/process-view.tsx` (passes `streaming` prop)
- Modify: `apps/web/src/components/summarize-view.tsx` (passes `streaming` prop)
- Modify: `apps/web/src/components/chat-panel.tsx` (passes `streaming` prop)

- [ ] **Step 1: Remove prop from type and destructuring**

In `apps/web/src/components/streaming-markdown.tsx`:
```typescript
// BEFORE:
type Props = {
  text: string;
  streaming?: boolean;
};
export function StreamingMarkdown({ text, streaming }: Props) {

// AFTER:
type Props = {
  text: string;
};
export function StreamingMarkdown({ text }: Props) {
```

- [ ] **Step 2: Remove `streaming` prop from all callers**

Search all `.tsx` files for `<StreamingMarkdown` and remove any `streaming={...}` prop.

- [ ] **Step 3: Build frontend to verify**

Run: `pnpm -C apps/web build`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/streaming-markdown.tsx apps/web/src/components/process-view.tsx apps/web/src/components/summarize-view.tsx apps/web/src/components/chat-panel.tsx
git commit -m "chore: remove unused streaming prop from StreamingMarkdown"
```

### Task 1.2: Inline `mergeConsecutiveSegments` — gutted function

**Files:**
- Modify: `packages/core/src/content/link-preview/content/article.ts`

- [ ] **Step 1: Find the call site and the function definition**

The function at line ~167-171:
```typescript
function mergeConsecutiveSegments(segments: string[]): string[] {
  return segments.filter(Boolean);
}
```

Find where it's called (should be around line 145) and replace with inline `.filter(Boolean)`.

- [ ] **Step 2: Replace call with inline filter and delete function**

```typescript
// BEFORE:
const merged = mergeConsecutiveSegments(segments);

// AFTER:
const merged = segments.filter(Boolean);
```

Delete the `mergeConsecutiveSegments` function entirely.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/article*.test.ts tests/link-preview*.test.ts`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/content/link-preview/content/article.ts
git commit -m "chore: inline mergeConsecutiveSegments (was just .filter(Boolean))"
```

### Task 1.3: Inline `executeProvider` — one-line passthrough

**Files:**
- Modify: `packages/core/src/content/transcript/index.ts`

- [ ] **Step 1: Find the function and its call site**

At line ~238-242:
```typescript
const executeProvider = async (
  provider: ProviderModule,
  context: ProviderContext,
  options: ProviderFetchOptions,
): Promise<ProviderResult> => provider.fetchTranscript(context, options);
```

- [ ] **Step 2: Replace all calls to `executeProvider(provider, context, options)` with `provider.fetchTranscript(context, options)` and delete the function**

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/transcript*.test.ts`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/content/transcript/index.ts
git commit -m "chore: inline executeProvider (was a one-line passthrough)"
```

### Task 1.4: Remove `historyId = summaryId` aliases

**Files:**
- Modify: `src/server/routes/summarize.ts`

- [ ] **Step 1: Find all three occurrences**

Search for `const historyId = summaryId` in the file. There are 3 occurrences (lines ~538, ~996, ~1107).

- [ ] **Step 2: Replace `historyId` with `summaryId` at each usage site and delete the alias lines**

For each occurrence: delete the `const historyId = summaryId;` line and replace any subsequent `historyId` references in that scope with `summaryId`.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/server.summarize.test.ts`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/summarize.ts
git commit -m "chore: remove historyId aliases (was just summaryId)"
```

### Task 1.5: Remove unused root dependencies

**Files:**
- Modify: Root `package.json`

- [ ] **Step 1: Remove `esbuild` from devDependencies**

It is unused — Vite bundles its own esbuild internally.

- [ ] **Step 2: Remove `@fal-ai/client` from devDependencies**

Only used in `packages/core` which already declares it as a dependency.

- [ ] **Step 3: Remove `@types/jsdom` and `@types/sanitize-html` from devDependencies**

Only needed in `packages/core` which already declares them.

- [ ] **Step 4: Remove `esbuild` from `pnpm-workspace.yaml` `onlyBuiltDependencies` if present**

Check `pnpm-workspace.yaml` for `esbuild` in the `onlyBuiltDependencies` list.

- [ ] **Step 5: Run `pnpm install` to update lockfile, then run tests**

Run: `pnpm install && pnpm vitest run`
Expected: Install succeeds, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "chore: remove unused root devDependencies (esbuild, fal-ai, jsdom/sanitize-html types)"
```

### Task 1.6: Fix Vite version constraint drift

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Update Vite version in apps/web**

The root `pnpm.overrides` forces Vite 7.3.0, but `apps/web/package.json` declares `"vite": "^6.0.0"`. Update it to match:

```json
"vite": "^7.0.0"
```

- [ ] **Step 2: Build to verify**

Run: `pnpm -C apps/web build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json
git commit -m "chore: align apps/web vite version with root override (^6 → ^7)"
```

---

## Chunk 2: DRY — Frontend Deduplication

### Task 2.1: Consolidate `formatFileSize`

**Files:**
- Modify: `apps/web/src/lib/format.ts` (keep this one — has GB support)
- Modify: `apps/web/src/lib/file-utils.ts` (remove `formatFileSize`)
- Modify: `apps/web/src/components/unified-input.tsx` (update import)

- [ ] **Step 1: Check which files import `formatFileSize` from `file-utils.ts`**

Run grep to find all import sites.

- [ ] **Step 2: Update imports in callers to use `format.ts`**

```typescript
// BEFORE:
import { formatFileSize } from "../lib/file-utils.js";
// AFTER:
import { formatFileSize } from "../lib/format.js";
```

- [ ] **Step 3: Remove `formatFileSize` export from `file-utils.ts`**

Delete the function from `file-utils.ts`.

- [ ] **Step 4: Build frontend**

Run: `pnpm -C apps/web build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/format.ts apps/web/src/lib/file-utils.ts apps/web/src/components/unified-input.tsx
git commit -m "fix: consolidate formatFileSize into single implementation with GB support"
```

### Task 2.2: Unify SSE stream parsing

**Files:**
- Modify: `apps/web/src/lib/api.ts`

The existing `parseSseStream` (line ~176) handles events via a `SseCallbacks` interface with named callbacks (`onInit`, `onStatus`, `onChunk`, etc.). The `streamSlidesEvents` and `streamChat` functions each duplicate the byte-level SSE parsing but handle different event names.

- [ ] **Step 1: Extend `parseSseStream` to accept a generic event-to-handler map**

Add a new lower-level function that parses the SSE byte stream and dispatches events via a map:

```typescript
type SseEventHandler = (data: any) => void;

async function parseSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handlers: Record<string, SseEventHandler>,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          handlers[currentEvent]?.(data);
        } catch { /* skip malformed */ }
        currentEvent = "";
      }
    }
  }
}
```

- [ ] **Step 2: Refactor `parseSseStream` to use `parseSseEvents`**

```typescript
function parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: SseCallbacks,
): Promise<void> {
  let gotDone = false;
  let gotChunks = false;
  return parseSseEvents(reader, {
    init: (data) => callbacks.onInit?.(data.summaryId),
    status: (data) => callbacks.onStatus?.(data.text),
    chunk: (data) => { gotChunks = true; callbacks.onChunk?.(data.text); },
    meta: (data) => callbacks.onMeta?.(data),
    done: (data) => { gotDone = true; callbacks.onDone?.(data.summaryId); },
    error: (data) => callbacks.onError?.(data.message, data.code),
    metrics: (data) => callbacks.onMetrics?.(data),
  }).then(() => {
    if (!gotDone && gotChunks) callbacks.onDone?.("unknown");
  });
}
```

- [ ] **Step 3: Refactor `streamSlidesEvents` to use `parseSseEvents`**

Replace the inline SSE loop (~lines 378-417) with:
```typescript
await parseSseEvents(reader, {
  status: (data) => callbacks.onStatus?.(data.text),
  slides: (data) => callbacks.onSlides?.(data),
  done: () => callbacks.onDone?.(),
  error: (data) => callbacks.onError?.(data.message),
});
```

- [ ] **Step 4: Refactor `streamChat` to use `parseSseEvents`**

Replace the inline SSE loop (~lines 460-491) with:
```typescript
await parseSseEvents(reader, {
  chunk: (data) => callbacks.onChunk?.(data.text),
  done: () => callbacks.onDone?.(),
  error: (data) => callbacks.onError?.(data.message),
});
```

- [ ] **Step 5: Build frontend**

Run: `pnpm -C apps/web build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "refactor: unify SSE parsing into single parseSseEvents function"
```

### Task 2.3: Deduplicate CSS custom properties

**Files:**
- Modify: `apps/web/src/styles/global.css`

- [ ] **Step 1: Restructure CSS to eliminate duplication**

The light/dark theme variables are duplicated: once under `@media (prefers-color-scheme: ...)` and once under `[data-theme="..."]`. Restructure so each set of variables is defined once:

```css
/* Define light theme variables once */
:root,
[data-theme="light"] {
  --bg: #ffffff;
  /* ... all light variables ... */
}

/* Dark theme: media query AND manual override */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f0f0f;
    /* ... all dark variables ... */
  }
}

[data-theme="dark"] {
  --bg: #0f0f0f;
  /* ... all dark variables ... */
}
```

Wait — this still duplicates dark vars. Better approach: use a mixin-like pattern with CSS layers or a shared class.

Actually the simplest approach: define light as default on `:root`, dark under both `@media` and `[data-theme="dark"]` using a single selector list where possible. The key insight: `@media` selectors can't be combined with attribute selectors in a single rule. So the minimal duplication is dark vars appearing twice.

The current code has 4 copies (light-media, dark-media, light-attr, dark-attr). We can reduce to 2:
- Light vars on `:root` (default) + `[data-theme="light"]` combined
- Dark vars duplicated in `@media` and `[data-theme="dark"]`

This cuts duplication in half from ~120 lines to ~60 lines.

- [ ] **Step 2: Build and visually verify**

Run: `pnpm -C apps/web build`
Expected: Build succeeds, themes render correctly.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles/global.css
git commit -m "refactor: reduce CSS theme variable duplication from 4 copies to 2"
```

---

## Chunk 3: DRY — Core Package Deduplication

### Task 3.1: Consolidate `appendNote`

**Files:**
- Keep: `packages/core/src/content/link-preview/content/utils.ts` (exported, canonical)
- Modify: `packages/core/src/content/transcript/index.ts` (delete local `appendNote`, import from utils)
- Modify: `packages/core/src/content/transcript/cache.ts` (delete local `appendNote`, import from utils)

- [ ] **Step 1: In `transcript/index.ts`, delete the local `appendNote` function (~line 244-249)**

Replace with import:
```typescript
import { appendNote } from "../link-preview/content/utils.js";
```

- [ ] **Step 2: In `transcript/cache.ts`, delete the local `appendNote` function (~line 108-113)**

Replace with import:
```typescript
import { appendNote } from "../link-preview/content/utils.js";
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/transcript*.test.ts tests/cache*.test.ts`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/content/transcript/index.ts packages/core/src/content/transcript/cache.ts
git commit -m "refactor: consolidate appendNote into single export (fixes behavioral divergence)"
```

### Task 3.2: Consolidate `decodeHtmlEntities`

**Files:**
- Keep: `packages/core/src/content/link-preview/content/cleaner.ts` (exported, canonical)
- Modify: `packages/core/src/content/transcript/utils.ts` (delete duplicate, import from cleaner)

- [ ] **Step 1: In `transcript/utils.ts`, delete the `decodeHtmlEntities` function (~line 116-126)**

Replace with re-export or import:
```typescript
import { decodeHtmlEntities } from "../link-preview/content/cleaner.js";
```

If `transcript/utils.ts` re-exports `decodeHtmlEntities` for consumers, add:
```typescript
export { decodeHtmlEntities } from "../link-preview/content/cleaner.js";
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/content/transcript/utils.ts
git commit -m "refactor: consolidate decodeHtmlEntities into single location"
```

### Task 3.3: Consolidate `normalizeKey` / `normalizeApiKey`

**Files:**
- Keep: `packages/core/src/transcription/whisper/provider-setup.ts` (`normalizeApiKey`, exported)
- Modify: `packages/core/src/content/transcript/transcription-config.ts` (delete `normalizeKey`, import `normalizeApiKey`)

- [ ] **Step 1: In `transcription-config.ts`, delete the private `normalizeKey` function (~line 33-36)**

Import instead:
```typescript
import { normalizeApiKey } from "../../transcription/whisper/provider-setup.js";
```

- [ ] **Step 2: Replace all usages of `normalizeKey(...)` with `normalizeApiKey(...)` in the file**

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/transcript*.test.ts tests/transcription*.test.ts`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/content/transcript/transcription-config.ts
git commit -m "refactor: consolidate normalizeKey into normalizeApiKey"
```

### Task 3.4: Remove duplicate `TranscriptResolution` type

**Files:**
- Keep: `packages/core/src/content/link-preview/types.ts` (canonical, exported from package)
- Modify: `packages/core/src/content/link-preview/content/types.ts` (delete duplicate, import from parent)

- [ ] **Step 1: Check what imports `TranscriptResolution` from `content/types.ts`**

Run grep to find consumers.

- [ ] **Step 2: Delete `TranscriptResolution` from `content/types.ts` and update consumers to import from `../types.js`**

If `content/types.ts` re-exports it, replace definition with:
```typescript
export type { TranscriptResolution } from "../types.js";
```

- [ ] **Step 3: Run type check and tests**

Run: `pnpm typecheck && pnpm vitest run`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/content/link-preview/content/types.ts
git commit -m "refactor: remove duplicate TranscriptResolution type definition"
```

### Task 3.5: Document `normalizeForPrompt` vs `normalizeWhitespace`

**Files:**
- Modify: `packages/core/src/content/link-preview/content/cleaner.ts`

- [ ] **Step 1: Add JSDoc comments explaining the difference**

```typescript
/**
 * Normalize whitespace for LLM prompt input — collapses excessive blank lines
 * to a maximum of one empty line (double newline) to save tokens.
 */
export function normalizeForPrompt(input: string): string { ... }

/**
 * Normalize whitespace while preserving paragraph structure — does NOT
 * collapse multiple blank lines. Use for content that will be displayed
 * to users where vertical spacing is meaningful.
 */
export function normalizeWhitespace(input: string): string { ... }
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/content/link-preview/content/cleaner.ts
git commit -m "docs: clarify normalizeForPrompt vs normalizeWhitespace contract"
```

---

## Chunk 4: DRY — Server Deduplication

### Task 4.1: Extract `buildSseSink` helper in summarize route

**Files:**
- Modify: `src/server/routes/summarize.ts`

- [ ] **Step 1: Identify the repeated SSE sink pattern**

The `StreamSink` object with `writeChunk`, `onModelChosen`, `writeStatus`, `writeMeta` is constructed identically in the file-upload SSE path (~line 326-377) and the URL/text SSE path (~line 654-705). Both use `pushAndBuffer`, `stream.writeSSE`, and track `chosenModel`.

- [ ] **Step 2: Extract a `buildSseSink` helper function**

```typescript
function buildSseSink(
  stream: SSEStreamingApi,
  pushAndBuffer: (event: SseEvent) => number,
  chunks: string[],
  onModelChosen: (model: string) => void,
): StreamSink {
  return {
    writeChunk: (text) => {
      chunks.push(text);
      const evt: SseEvent = { event: "chunk", data: { text } };
      const id = pushAndBuffer(evt);
      void stream.writeSSE({ event: "chunk", data: JSON.stringify(evt.data), id: String(id) });
    },
    onModelChosen: (model) => {
      onModelChosen(model);
      console.log(`[summarize-api] model chosen: ${model}`);
      const evt: SseEvent = { event: "meta", data: { model, modelLabel: model, inputSummary: null } };
      const id = pushAndBuffer(evt);
      void stream.writeSSE({ event: "meta", data: JSON.stringify(evt.data), id: String(id) });
    },
    writeStatus: (text) => {
      const evt: SseEvent = { event: "status", data: { text } };
      const id = pushAndBuffer(evt);
      void stream.writeSSE({ event: "status", data: JSON.stringify(evt.data), id: String(id) });
    },
    writeMeta: (data) => {
      const evt: SseEvent = { event: "meta", data };
      const id = pushAndBuffer(evt);
      void stream.writeSSE({ event: "meta", data: JSON.stringify(evt.data), id: String(id) });
    },
  };
}
```

- [ ] **Step 3: Replace both inline sink constructions with calls to `buildSseSink`**

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/server.summarize.test.ts tests/server.sse-streaming.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/summarize.ts
git commit -m "refactor: extract buildSseSink helper to deduplicate SSE sink construction"
```

### Task 4.2: Extract shared test helpers

**Files:**
- Create: `tests/helpers/server-test-utils.ts`
- Modify: `tests/server.summarize.test.ts`
- Modify: `tests/server.sse-streaming.test.ts`
- Modify: `tests/server.upload.test.ts`

- [ ] **Step 1: Create shared `tests/helpers/server-test-utils.ts`**

Extract the common `fakeDeps` base object and `createTestApp` factory:

```typescript
import { Hono } from "hono";

export function baseFakeDeps() {
  return {
    env: {} as Record<string, string | undefined>,
    config: null,
    cache: { mode: "bypass" as const, store: null },
    mediaCache: null,
    historyStore: null,
    historyMediaPath: null,
    accounts: [{ name: "test", token: "test-token-123" }],
  };
}

export function mockPipelineResult(overrides: Record<string, any> = {}) {
  return {
    usedModel: "openai/gpt-4o",
    report: {
      llm: [{ provider: "openai", model: "gpt-4o", calls: 1, promptTokens: 500, completionTokens: 200, totalTokens: 700 }],
      services: { firecrawl: { requests: 0 }, apify: { requests: 0 } },
      pipeline: null,
    },
    metrics: {
      elapsedMs: 1234,
      summary: "1.2s",
      details: null,
      summaryDetailed: "1.234s",
      detailsDetailed: null,
      pipeline: null,
    },
    insights: null,
    extracted: {
      url: "https://example.com",
      title: "Test Article",
      content: "body",
      transcriptSource: null,
    },
    ...overrides,
  } as any;
}
```

- [ ] **Step 2: Update test files to import from shared helper**

Replace inline `fakeDeps` and mock result objects with imports.

- [ ] **Step 3: Remove duplicate `createTestApp` in `server.summarize.test.ts`**

The file has two identical definitions (lines ~14-19 and ~72-77). Keep one, or move to shared helper.

- [ ] **Step 4: Run all server tests**

Run: `pnpm vitest run tests/server.*.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/server-test-utils.ts tests/server.summarize.test.ts tests/server.sse-streaming.test.ts tests/server.upload.test.ts
git commit -m "refactor: extract shared test helpers (fakeDeps, mockPipelineResult)"
```

---

## Chunk 5: Server Bug Fixes

### Task 5.1: Unref SseSessionManager cleanup timer

**Files:**
- Modify: `src/server/sse-session.ts`

- [ ] **Step 1: Add `.unref()` to the cleanup interval**

In the constructor (~line 36-38):
```typescript
// BEFORE:
this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);

// AFTER:
this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
this.cleanupTimer.unref();
```

This prevents the timer from keeping the process alive during shutdown.

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/server.sse-session.test.ts`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/server/sse-session.ts
git commit -m "fix: unref SseSessionManager cleanup timer to allow clean shutdown"
```

### Task 5.2: Add url/text mutual exclusivity validation

**Files:**
- Modify: `src/server/routes/summarize.ts`
- Modify: `tests/server.summarize.test.ts`

- [ ] **Step 1: Write failing test**

Add test to `tests/server.summarize.test.ts`:
```typescript
it("rejects when both url and text are provided", async () => {
  const res = await app.request("/v1/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token-123" },
    body: JSON.stringify({ url: "https://example.com", text: "hello" }),
  });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("INVALID_INPUT");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.summarize.test.ts -t "rejects when both"`
Expected: FAIL (currently returns 200).

- [ ] **Step 3: Add validation in `validateBody`**

In `src/server/routes/summarize.ts`, in the `validateBody` function, add after the individual type checks:
```typescript
if (body.url && body.text) {
  return {
    error: jsonError("INVALID_INPUT", "Provide either url or text, not both"),
    status: 400,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/server.summarize.test.ts`
Expected: All pass including new test.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/summarize.ts tests/server.summarize.test.ts
git commit -m "fix: reject requests with both url and text (enforce mutual exclusivity)"
```

### Task 5.3: Add .catch() to fetchMe in App.tsx

**Files:**
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Add .catch() handler**

```typescript
// BEFORE:
fetchMe().then((info) => {
  setAccount(info);
  setAuthChecked(true);
});

// AFTER:
fetchMe()
  .then((info) => {
    setAccount(info);
    setAuthChecked(true);
  })
  .catch(() => {
    setAuthChecked(true);
  });
```

- [ ] **Step 2: Build frontend**

Run: `pnpm -C apps/web build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app.tsx
git commit -m "fix: handle fetchMe rejection to prevent app hanging"
```

### Task 5.4: Fix stale closure in HistoryView offset pattern

**Files:**
- Modify: `apps/web/src/components/history-view.tsx`

- [ ] **Step 1: Refactor load to take offset as parameter**

```typescript
// BEFORE:
const load = useCallback(async (append = false) => {
  setLoading(true);
  try {
    const nextOffset = append ? offset : 0;
    // ...
  }
}, [offset]);

useEffect(() => { load(false); }, []);

// AFTER:
const load = useCallback(async (append = false, fromOffset = 0) => {
  setLoading(true);
  try {
    const data = await fetchHistory(20, fromOffset);
    setTotal(data.total);
    if (append) {
      setEntries((prev) => [...prev, ...data.entries]);
      setOffset(fromOffset + data.entries.length);
    } else {
      setEntries(data.entries);
      setOffset(data.entries.length);
    }
  } catch {
    // silently fail
  } finally {
    setLoading(false);
  }
}, []);

useEffect(() => { load(false, 0); }, []);
```

Then update the "Load more" button to pass `offset`:
```typescript
onClick={() => load(true, offset)}
```

- [ ] **Step 2: Build frontend**

Run: `pnpm -C apps/web build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/history-view.tsx
git commit -m "fix: resolve stale closure in HistoryView load callback"
```

### Task 5.5: Add Escape key handler to Lightbox

**Files:**
- Modify: `apps/web/src/components/slides-viewer.tsx`

- [ ] **Step 1: Add useEffect for Escape key**

In the `Lightbox` component, add:
```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };
  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, [onClose]);
```

- [ ] **Step 2: Build frontend**

Run: `pnpm -C apps/web build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/slides-viewer.tsx
git commit -m "fix: add Escape key handler to Lightbox component"
```

---

## Chunk 6: Test Health

### Task 6.1: Fix timing-dependent fire-and-forget assertions

**Files:**
- Modify: `tests/server.summarize.test.ts`

- [ ] **Step 1: Find all `setTimeout(r, 10)` patterns**

Search for `setTimeout` in the file. Replace with `vi.waitFor()`:

```typescript
// BEFORE:
await new Promise((r) => setTimeout(r, 10));
expect(historyStore.getById(summaryId, "test")).toBeTruthy();

// AFTER:
await vi.waitFor(() => {
  expect(historyStore.getById(summaryId, "test")).toBeTruthy();
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/server.summarize.test.ts`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add tests/server.summarize.test.ts
git commit -m "fix: replace setTimeout assertions with vi.waitFor for reliability"
```

### Task 6.2: Fix missing mockRestore on error classification spies

**Files:**
- Modify: `tests/server.summarize.test.ts`

- [ ] **Step 1: Add afterEach cleanup in the error classification describe block**

```typescript
describe("POST /v1/summarize – error classification", () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });

  it("returns FETCH_FAILED ...", async () => {
    spy = vi.spyOn(summarizeMod, "streamSummaryForUrl").mockRejectedValueOnce(...);
    // ...
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/server.summarize.test.ts`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add tests/server.summarize.test.ts
git commit -m "fix: properly restore spies in error classification tests"
```

### Task 6.3: Add vitest coverage for packages/core

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add `packages/core/src/**/*.ts` to coverage include**

```typescript
coverage: {
  include: ["src/**/*.ts", "packages/core/src/**/*.ts"],
  // ...
}
```

- [ ] **Step 2: Run coverage**

Run: `pnpm vitest run --coverage`
Expected: Coverage report now includes core package files.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: include packages/core in vitest coverage reporting"
```

---

## Final Verification

After all chunks are complete:

- [ ] **Run full test suite:** `pnpm vitest run`
- [ ] **Run lint:** `pnpm lint`
- [ ] **Build everything:** `pnpm build`
- [ ] **Verify frontend:** `pnpm -C apps/web build`

All must pass before considering this plan complete.
