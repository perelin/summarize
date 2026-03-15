# Structured Insights for Web API Response

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured `insights` object to the API response so the web frontend can display rich metadata about each summarization run (cache status, cost, word count, media info, etc.)

**Architecture:** Build `SummarizeInsights` inside `streamSummaryForUrl` / `streamSummaryForVisiblePage` (Option A) where the extracted content and cost data are already in scope. The API route passes it through. The frontend renders each field as a pill in the metadata bar.

**Tech Stack:** TypeScript, Hono (API server), vanilla JS (frontend)

---

## File Structure

| Action | File                             | Responsibility                                                                           |
| ------ | -------------------------------- | ---------------------------------------------------------------------------------------- |
| Modify | `src/server/types.ts`            | Add `SummarizeInsights` type, add to `SummarizeResponse`                                 |
| Modify | `src/daemon/summarize.ts`        | Build insights in `streamSummaryForUrl` and `streamSummaryForVisiblePage`, add to return |
| Modify | `src/server/routes/summarize.ts` | Pass `result.insights` through to response                                               |
| Modify | `src/server/public/index.html`   | Render insights fields in metadata bar                                                   |
| Modify | `tests/server.summarize.test.ts` | Add tests for insights in success responses                                              |

---

## Chunk 1: Type + Backend

### Task 1: Define `SummarizeInsights` type

**Files:**

- Modify: `src/server/types.ts`

- [ ] **Step 1: Add the SummarizeInsights type and update SummarizeResponse**

```typescript
// Add to src/server/types.ts, after existing imports:
import type { PipelineReport } from "../run/run-metrics.js";

export type SummarizeInsights = {
  // Content
  title: string | null;
  siteName: string | null;
  wordCount: number | null;
  characterCount: number | null;
  truncated: boolean;

  // Media
  mediaDurationSeconds: number | null;
  transcriptSource: string | null;
  transcriptionProvider: string | null;

  // Cache
  cacheStatus: "hit" | "miss" | "expired" | "bypassed" | "fallback" | "unknown" | null;
  summaryFromCache: boolean;

  // Cost
  costUsd: number | null;

  // Tokens (broken out)
  inputTokens: number | null;
  outputTokens: number | null;

  // Extraction
  extractionMethod: string | null;
  servicesUsed: string[];
  attemptedProviders: string[];

  // Timing
  stages: Array<{ stage: string; durationMs: number }>;
};
```

Update `SummarizeResponse` — replace the existing `pipeline?` field (just merged) with the more complete `insights`:

```typescript
export type SummarizeResponse = {
  summary: string;
  metadata: {
    title: string | null;
    source: string;
    model: string;
    usage: { inputTokens: number; outputTokens: number } | null;
    durationMs: number;
  };
  insights: SummarizeInsights | null;
};
```

Note: this removes the `pipeline?` field we just added — `insights` subsumes it entirely (includes `stages`, `extractionMethod`, etc).

- [ ] **Step 2: Verify build compiles**

Run: `pnpm -s build`
Expected: Build will fail because `summarize.ts` return type and route code reference old field — that's expected, we fix it in the next tasks.

---

### Task 2: Build insights in `streamSummaryForUrl`

**Files:**

- Modify: `src/daemon/summarize.ts`

- [ ] **Step 1: Add import and helper function**

Add at top of `src/daemon/summarize.ts`:

```typescript
import type { SummarizeInsights } from "../server/types.js";
```

Add a helper function after `buildInputSummaryForExtracted` (around line 142):

```typescript
function buildInsightsForExtracted({
  extracted,
  report,
  costUsd,
  summaryFromCache,
}: {
  extracted: ExtractedLinkContent;
  report: RunMetricsReport;
  costUsd: number | null;
  summaryFromCache: boolean;
}): SummarizeInsights {
  const usage = report.llm[0] ?? null;
  const pipeline = report.pipeline;

  const servicesUsed: string[] = [];
  if (report.services.firecrawl.requests > 0) servicesUsed.push("firecrawl");
  if (report.services.apify.requests > 0) servicesUsed.push("apify");

  return {
    title: extracted.title ?? null,
    siteName: extracted.siteName ?? null,
    wordCount: extracted.wordCount ?? null,
    characterCount: extracted.totalCharacters ?? null,
    truncated: extracted.truncated ?? false,

    mediaDurationSeconds: extracted.mediaDurationSeconds ?? null,
    transcriptSource: extracted.transcriptSource ?? null,
    transcriptionProvider: extracted.transcriptionProvider ?? null,

    cacheStatus:
      (extracted.diagnostics?.transcript?.cacheStatus as SummarizeInsights["cacheStatus"]) ?? null,
    summaryFromCache,

    costUsd,

    inputTokens: usage?.promptTokens ?? null,
    outputTokens: usage?.completionTokens ?? null,

    extractionMethod: pipeline?.info?.extractionMethod ?? null,
    servicesUsed,
    attemptedProviders: extracted.diagnostics?.transcript?.attemptedProviders ?? [],

    stages: pipeline?.stages ?? [],
  };
}
```

- [ ] **Step 2: Update `streamSummaryForUrl` return type and add insights**

Change the return type (line 344):

```typescript
}): Promise<{ usedModel: string; report: RunMetricsReport; metrics: VisiblePageMetrics; insights: SummarizeInsights }> {
```

In the return statement (around line 420), add `insights`:

```typescript
return {
  usedModel: modelLabel,
  report,
  metrics: buildDaemonMetrics({
    elapsedMs,
    summaryFromCache,
    label,
    modelLabel,
    report,
    costUsd,
    compactExtraParts,
    detailedExtraParts,
  }),
  insights: buildInsightsForExtracted({ extracted, report, costUsd, summaryFromCache }),
};
```

- [ ] **Step 3: Update `streamSummaryForVisiblePage` return type and add insights**

Change the return type (line 170):

```typescript
}): Promise<{ usedModel: string; report: RunMetricsReport; metrics: VisiblePageMetrics; insights: SummarizeInsights | null }> {
```

For text mode, build a sparse insights object. In the return statement (around line 283):

```typescript
const usage = report.llm[0] ?? null;
return {
  usedModel: modelLabel,
  report,
  metrics: buildDaemonMetrics({
    elapsedMs,
    summaryFromCache,
    label,
    modelLabel,
    report,
    costUsd,
    compactExtraParts: null,
    detailedExtraParts: null,
  }),
  insights: {
    title: null,
    siteName: null,
    wordCount: extracted.wordCount ?? null,
    characterCount: extracted.totalCharacters ?? null,
    truncated: extracted.truncated ?? false,
    mediaDurationSeconds: null,
    transcriptSource: null,
    transcriptionProvider: null,
    cacheStatus: null,
    summaryFromCache,
    costUsd,
    inputTokens: usage?.promptTokens ?? null,
    outputTokens: usage?.completionTokens ?? null,
    extractionMethod: null,
    servicesUsed: [],
    attemptedProviders: [],
    stages: report.pipeline?.stages ?? [],
  },
};
```

- [ ] **Step 4: Verify build compiles**

Run: `pnpm -s build`
Expected: May still fail on route code — proceed to Task 3.

---

### Task 3: Update API route to pass insights through

**Files:**

- Modify: `src/server/routes/summarize.ts`

- [ ] **Step 1: Replace `pipeline` with `insights` in URL-mode response**

In the URL-mode response (around line 164), replace `pipeline: result.report?.pipeline ?? null` with:

```typescript
insights: result.insights,
```

- [ ] **Step 2: Replace `pipeline` with `insights` in text-mode response**

In the text-mode response (around line 215), replace `pipeline: result.report?.pipeline ?? null` with:

```typescript
insights: result.insights,
```

- [ ] **Step 3: Verify full build**

Run: `pnpm -s build`
Expected: PASS — no errors.

- [ ] **Step 4: Run existing server tests**

Run: `pnpm vitest run tests/server.*.test.ts`
Expected: All 24 tests pass (mocked tests don't check insights field).

- [ ] **Step 5: Commit**

```bash
git add src/server/types.ts src/daemon/summarize.ts src/server/routes/summarize.ts
git commit -m "feat: add structured insights to API response

- Define SummarizeInsights type with content, media, cache, cost, and timing fields
- Build insights inside streamSummaryForUrl/streamSummaryForVisiblePage
- Replace raw pipeline field with richer insights object in API response
- Text mode returns sparse insights (LLM-related fields only)"
```

---

## Chunk 2: Frontend + Tests

### Task 4: Update web frontend to display insights

**Files:**

- Modify: `src/server/public/index.html`

- [ ] **Step 1: Replace the existing metadata rendering with insights-aware code**

Replace the entire metadata building block (the `// Build metadata` section through `resultEl.classList.add("visible")`) with:

```javascript
// Build metadata from insights
var parts = [];
var ins = data.insights;

// Title
if (ins && ins.title) {
  parts.push(ins.title);
} else if (data.metadata && data.metadata.title) {
  parts.push(data.metadata.title);
}

// Model
if (data.metadata && data.metadata.model) {
  parts.push("Model: " + data.metadata.model);
}

// Cache
if (ins && ins.summaryFromCache) {
  parts.push("Cached");
}

// Duration
if (data.metadata && data.metadata.durationMs != null) {
  parts.push("Duration: " + (data.metadata.durationMs / 1000).toFixed(1) + "s");
}

// Cost
if (ins && ins.costUsd != null) {
  parts.push("Cost: $" + ins.costUsd.toFixed(4));
}

// Extraction method
if (ins && ins.extractionMethod) {
  var method = "Method: " + ins.extractionMethod;
  if (ins.transcriptionProvider) {
    method += " (" + ins.transcriptionProvider + ")";
  }
  parts.push(method);
}

// Cache status (transcript)
if (ins && ins.cacheStatus && ins.cacheStatus !== "unknown") {
  parts.push("Cache: " + ins.cacheStatus);
}

// Media duration
if (ins && ins.mediaDurationSeconds != null) {
  var mins = Math.round(ins.mediaDurationSeconds / 60);
  parts.push(mins > 0 ? mins + "min media" : Math.round(ins.mediaDurationSeconds) + "s media");
}

// Word count
if (ins && ins.wordCount != null && ins.wordCount > 0) {
  var wc = ins.wordCount >= 1000 ? (ins.wordCount / 1000).toFixed(1) + "k" : ins.wordCount;
  parts.push(wc + " words");
}

// Tokens
if (ins && (ins.inputTokens != null || ins.outputTokens != null)) {
  var tokIn = ins.inputTokens || 0;
  var tokOut = ins.outputTokens || 0;
  parts.push(
    "Tokens: " +
      (tokIn + tokOut).toLocaleString() +
      " (" +
      tokIn.toLocaleString() +
      " in / " +
      tokOut.toLocaleString() +
      " out)",
  );
} else if (data.metadata && data.metadata.usage) {
  var u = data.metadata.usage;
  var total = (u.inputTokens || 0) + (u.outputTokens || 0);
  parts.push("Tokens: " + total.toLocaleString());
}

// Services
if (ins && ins.servicesUsed && ins.servicesUsed.length > 0) {
  parts.push("Services: " + ins.servicesUsed.join(", "));
}

// Attempted providers (fallback chain)
if (ins && ins.attemptedProviders && ins.attemptedProviders.length > 1) {
  parts.push("Tried: " + ins.attemptedProviders.join(" → "));
}

// Pipeline timing
if (ins && ins.stages && ins.stages.length > 0) {
  var timing = ins.stages
    .map(function (s) {
      return (
        s.stage.replace(/-/g, " ").replace(/\b\w/g, function (c) {
          return c.toUpperCase();
        }) +
        ": " +
        formatDuration(s.durationMs)
      );
    })
    .join(" | ");
  parts.push(timing);
}

resultMeta.innerHTML = parts
  .map(function (p) {
    return "<span>" + escapeHtml(p) + "</span>";
  })
  .join("");
resultEl.classList.add("visible");
```

- [ ] **Step 2: Verify locally by building**

Run: `pnpm -s build`
Expected: PASS

---

### Task 5: Add tests for insights in API response

**Files:**

- Modify: `tests/server.summarize.test.ts`

- [ ] **Step 1: Add a success-path test for URL mode with insights**

Add a new `describe` block at the end of the file:

```typescript
describe("POST /v1/summarize – insights in response", () => {
  it("returns insights for URL mode", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForUrl").mockResolvedValueOnce({
      usedModel: "openai/gpt-4o",
      report: {
        llm: [
          {
            provider: "openai",
            model: "gpt-4o",
            calls: 1,
            promptTokens: 500,
            completionTokens: 200,
            totalTokens: 700,
          },
        ],
        services: { firecrawl: { requests: 0 }, apify: { requests: 0 } },
        pipeline: null,
      },
      metrics: {
        elapsedMs: 1234,
        summary: "",
        details: null,
        summaryDetailed: "",
        detailsDetailed: null,
        pipeline: null,
      },
      insights: {
        title: "Test Article",
        siteName: "example.com",
        wordCount: 1500,
        characterCount: 9000,
        truncated: false,
        mediaDurationSeconds: null,
        transcriptSource: null,
        transcriptionProvider: null,
        cacheStatus: "miss",
        summaryFromCache: false,
        costUsd: 0.0042,
        inputTokens: 500,
        outputTokens: 200,
        extractionMethod: "html",
        servicesUsed: [],
        attemptedProviders: [],
        stages: [{ stage: "llm-query", durationMs: 800 }],
      },
    } as any);

    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insights).toBeDefined();
    expect(body.insights.title).toBe("Test Article");
    expect(body.insights.wordCount).toBe(1500);
    expect(body.insights.costUsd).toBe(0.0042);
    expect(body.insights.cacheStatus).toBe("miss");
    expect(body.insights.extractionMethod).toBe("html");
    expect(body.insights.summaryFromCache).toBe(false);
    expect(body.insights.stages).toHaveLength(1);
  });

  it("returns null insights when not provided (text mode fallback)", async () => {
    vi.spyOn(summarizeMod, "streamSummaryForVisiblePage").mockResolvedValueOnce({
      usedModel: "openai/gpt-4o",
      report: {
        llm: [
          {
            provider: "openai",
            model: "gpt-4o",
            calls: 1,
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        ],
        services: { firecrawl: { requests: 0 }, apify: { requests: 0 } },
        pipeline: null,
      },
      metrics: {
        elapsedMs: 500,
        summary: "",
        details: null,
        summaryDetailed: "",
        detailsDetailed: null,
        pipeline: null,
      },
      insights: {
        title: null,
        siteName: null,
        wordCount: 5,
        characterCount: 25,
        truncated: false,
        mediaDurationSeconds: null,
        transcriptSource: null,
        transcriptionProvider: null,
        cacheStatus: null,
        summaryFromCache: false,
        costUsd: 0.001,
        inputTokens: 100,
        outputTokens: 50,
        extractionMethod: null,
        servicesUsed: [],
        attemptedProviders: [],
        stages: [],
      },
    } as any);

    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello world test" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insights).toBeDefined();
    expect(body.insights.wordCount).toBe(5);
    expect(body.insights.costUsd).toBe(0.001);
    expect(body.insights.extractionMethod).toBeNull();
  });
});
```

- [ ] **Step 2: Run all server tests**

Run: `pnpm vitest run tests/server.*.test.ts`
Expected: All tests pass (24 existing + 2 new = 26 total).

- [ ] **Step 3: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/public/index.html tests/server.summarize.test.ts
git commit -m "feat: display structured insights in web frontend

- Render title, cache status, cost, word count, media duration, tokens, services
- Show transcription provider fallback chain when multiple providers attempted
- Add tests verifying insights in URL and text mode API responses"
```

---

### Task 6: Build, deploy, and verify

- [ ] **Step 1: Full build**

Run: `pnpm -s build`
Expected: PASS

- [ ] **Step 2: Deploy**

```bash
docker buildx build --platform linux/amd64 -t ghcr.io/perelin/summarize-api:latest --push .
ssh pve-htz-docker 'cd /opt/apps/summarize && docker compose pull -q && docker compose up -d'
```

- [ ] **Step 3: Verify on production**

Test with a URL in the web UI at summarize.p2lab.com and confirm the metadata bar shows the new fields.
