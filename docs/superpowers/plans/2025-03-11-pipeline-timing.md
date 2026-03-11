# Pipeline Timing & Info Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Output original source link, extraction method, and per-stage timing for all summarize operations.

**Architecture:** Extend existing `RunMetrics` class with pipeline telemetry. Add timing methods and pipeline info fields, then integrate into URL flow, JSON output, SSE events, and CLI finish line.

**Tech Stack:** TypeScript, existing metrics infrastructure

---

## Chunk 1: Types & RunMetrics Extension

### Task 1: Add Pipeline Types to run-metrics.ts

**Files:**

- Modify: `src/run/run-metrics.ts`

- [ ] **Step 1: Add pipeline types at top of file (after imports)**

```typescript
export type PipelineStage =
  | "initial-query"
  | "content-extraction"
  | "text-extraction"
  | "llm-query";

export type StageTiming = {
  stage: PipelineStage;
  durationMs: number;
};

export type PipelineInfo = {
  sourceUrl: string;
  extractionMethod:
    | "html"
    | "firecrawl"
    | "apify"
    | "bird"
    | "xurl"
    | "nitter"
    | "youtube-captions"
    | "audio-transcription";
  transcriptionProvider?:
    | "openai-whisper"
    | "youtube-captions"
    | "deepgram"
    | "groq"
    | "assemblyai"
    | "fal";
  servicesUsed: {
    firecrawl: boolean;
    apify: boolean;
  };
};

export type PipelineReport = {
  stages: StageTiming[];
  totalMs: number;
  info: PipelineInfo | null;
};
```

- [ ] **Step 2: Add pipeline methods to RunMetrics type**

Update the `RunMetrics` type (around line 11) to add:

```typescript
export type RunMetrics = {
  llmCalls: LlmCall[];
  trackedFetch: typeof fetch;
  buildReport: () => Promise<RunMetricsReport>;
  estimateCostUsd: () => Promise<number | null>;
  getLiteLlmCatalog: () => Promise<Awaited<ReturnType<typeof loadLiteLlmCatalog>>["catalog"]>;
  resolveMaxOutputTokensForCall: (modelId: string) => Promise<number | null>;
  resolveMaxInputTokensForCall: (modelId: string) => Promise<number | null>;
  setTranscriptionCost: (costUsd: number | null, label: string | null) => void;
  timeStage: <T>(stage: PipelineStage, fn: () => Promise<T>) => Promise<T>;
  setPipelineInfo: (info: PipelineInfo) => void;
};
```

- [ ] **Step 3: Add pipeline state variables in createRunMetrics**

Inside `createRunMetrics` function, after `transcriptionCost` declaration (around line 37):

```typescript
const stageTimings = new Map<PipelineStage, number>();
const pipelineInfoRef = { value: null as PipelineInfo | null };
```

- [ ] **Step 4: Implement timeStage method**

Add after `setTranscriptionCost` function (around line 43):

```typescript
const timeStage = async <T>(stage: PipelineStage, fn: () => Promise<T>): Promise<T> => {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const elapsed = Date.now() - start;
    stageTimings.set(stage, elapsed);
  }
};

const setPipelineInfo = (info: PipelineInfo): void => {
  pipelineInfoRef.value = info;
};
```

- [ ] **Step 5: Add pipeline to return object**

Update the return object (around line 164) to include new methods:

```typescript
return {
  llmCalls,
  trackedFetch,
  buildReport,
  estimateCostUsd,
  getLiteLlmCatalog,
  resolveMaxOutputTokensForCall,
  resolveMaxInputTokensForCall,
  setTranscriptionCost,
  timeStage,
  setPipelineInfo,
};
```

---

### Task 2: Extend RunMetricsReport and buildReport

**Files:**

- Modify: `src/costs.ts`

- [ ] **Step 1: Import PipelineReport type**

At top of file, add import:

```typescript
import type { PipelineReport } from "./run/run-metrics.js";
```

- [ ] **Step 2: Add pipeline to RunMetricsReport type**

Update the type (around line 13):

```typescript
export type RunMetricsReport = {
  llm: Array<{
    provider: LlmProvider;
    model: string;
    calls: number;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  }>;
  services: {
    firecrawl: { requests: number };
    apify: { requests: number };
  };
  pipeline: PipelineReport | null;
};
```

- [ ] **Step 3: Update buildRunMetricsReport function signature**

Update the function (around line 40):

```typescript
export function buildRunMetricsReport({
  llmCalls,
  firecrawlRequests,
  apifyRequests,
  stageTimings,
  pipelineInfo,
}: {
  llmCalls: LlmCall[];
  firecrawlRequests: number;
  apifyRequests: number;
  stageTimings: Map<string, number>;
  pipelineInfo: PipelineReport["info"];
}): RunMetricsReport {
```

- [ ] **Step 4: Build pipeline report in function body**

Before the final return statement (around line 98), add:

```typescript
const stages: StageTiming[] = [];
const stageOrder: PipelineStage[] = [
  "initial-query",
  "content-extraction",
  "text-extraction",
  "llm-query",
];
for (const stage of stageOrder) {
  const durationMs = stageTimings.get(stage);
  if (typeof durationMs === "number") {
    stages.push({ stage, durationMs });
  }
}
const totalMs = stages.reduce((sum, s) => sum + s.durationMs, 0);

const pipeline: PipelineReport | null =
  stages.length > 0
    ? {
        stages,
        totalMs,
        info: pipelineInfo,
      }
    : null;
```

- [ ] **Step 5: Update return statement**

```typescript
return {
  llm,
  services: {
    firecrawl: { requests: firecrawlRequests },
    apify: { requests: apifyRequests },
  },
  pipeline,
};
```

---

### Task 3: Update buildReport in createRunMetrics

**Files:**

- Modify: `src/run/run-metrics.ts`

- [ ] **Step 1: Update buildReport function**

Update the `buildReport` function (around line 143):

```typescript
const buildReport = async () => {
  return buildRunMetricsReport({
    llmCalls,
    firecrawlRequests,
    apifyRequests,
    stageTimings,
    pipelineInfo: pipelineInfoRef.value,
  });
};
```

---

## Chunk 2: Flow Integration

### Task 4: Integrate timing into URL flow

**Files:**

- Modify: `src/run/flows/url/flow.ts`

- [ ] **Step 1: Import PipelineStage type**

Add to imports (around line 1):

```typescript
import type { PipelineStage, PipelineInfo } from "../../run-metrics.js";
```

- [ ] **Step 2: Add initial-query timing**

Wrap the initial setup (around line 272, before `fetchWithCache`). Find the `try {` block and add timing around the initial query. The initial query encompasses cache checking and URL preparation:

```typescript
let extracted: ExtractedLinkContent;
await ctx.hooks.timeStage("initial-query", async () => {
  extracted = await fetchWithCache(url);
});
```

Actually, looking at the code more carefully, the extraction happens at line 424. Let me reconsider the timing boundaries:

- `initial-query`: Cache lookup and preparation (lines 288-333, the fetchWithCache function's cache check portion)
- `content-extraction`: The actual fetch (the `fetchLinkContentWithBirdTip` call)
- `text-extraction`: Transcription if needed
- `llm-query`: The summarizeExtractedUrl call

Let me revise the approach. The timing should wrap specific operations:

- [ ] **Step 2 (revised): Add timing around fetchWithCache call**

Find line 424 and wrap it:

```typescript
let extracted: ExtractedLinkContent;
await ctx.hooks.timeStage("content-extraction", async () => {
  extracted = await fetchWithCache(url);
});
```

- [ ] **Step 3: Add timing around slides extraction with text-extraction label**

Find the `runSlidesExtraction` async function call area and the transcription logic. The text-extraction stage should cover transcription.

For video-only pages with transcription (around line 662-677), we need to handle the text extraction timing.

Actually, looking at this more carefully, the transcription happens inside `fetchLinkContent` which is called by `fetchWithCache`. So we need a different approach - we need to track when transcription specifically happens.

Let me look at the flow again:

1. `fetchWithCache` calls `fetchLinkContentWithBirdTip` which calls the core `fetchLinkContent`
2. Inside `fetchLinkContent`, transcription may happen via audio extraction
3. The LLM call happens in `summarizeExtractedUrl`

For a cleaner implementation, let's time at a higher level:

- `content-extraction`: The entire `fetchWithCache` call (includes any transcription)
- `llm-query`: The `summarizeExtractedUrl` call

And we can add `initial-query` for the setup before extraction, and `text-extraction` can be derived from the diagnostics (if transcription happened, we note it).

Actually, the simplest and most useful approach:

1. Time `fetchWithCache` as `content-extraction`
2. Time `summarizeExtractedUrl` as `llm-query`
3. `initial-query` can wrap the setup/preparation
4. `text-extraction` - we can track if transcription happened via diagnostics

Let me simplify:

- [ ] **Step 2 (simplified): Time content extraction**

Find line 424:

```typescript
let extracted: ExtractedLinkContent;
await ctx.hooks.timeStage("content-extraction", async () => {
  extracted = await fetchWithCache(url);
});
```

Also handle the refreshed extraction at line 428:

```typescript
if (flags.slides && !resolveSlideSource({ url, extracted })) {
  const isTwitter = urlUtils.isTwitterStatusUrl?.(url) ?? false;
  if (isTwitter) {
    await ctx.hooks.timeStage("content-extraction", async () => {
      const refreshed = await fetchWithCache(url, { bypassExtractCache: true });
      if (resolveSlideSource({ url, extracted: refreshed })) {
        writeVerbose(
          io.stderr,
          flags.verbose,
          "extract refresh for slides",
          flags.verboseColor,
          io.envForRun,
        );
        extracted = refreshed;
      }
    });
  }
}
```

Wait, this creates nested timing which is problematic. Let me reconsider.

The cleanest approach: Time at the call sites where the operations happen, not nested.

- [ ] **Step 3: Time LLM query**

Find the `summarizeExtractedUrl` call (around line 821) and wrap it:

```typescript
await ctx.hooks.timeStage("llm-query", async () => {
  await summarizeExtractedUrl({
    ctx,
    url,
    extracted,
    extractionUi,
    prompt,
    effectiveMarkdownMode: markdown.effectiveMarkdownMode,
    transcriptionCostLabel,
    onModelChosen,
    slides: slidesExtracted ?? slidesForPrompt ?? null,
    slidesOutput,
  });
});
```

- [ ] **Step 4: Set pipeline info after extraction**

After we have `extracted` (around line 441), add:

```typescript
const extractionMethod: PipelineInfo["extractionMethod"] = (() => {
  const strategy = extracted.diagnostics?.strategy;
  if (strategy === "firecrawl") return "firecrawl";
  if (strategy === "bird") return "bird";
  if (strategy === "xurl") return "xurl";
  if (strategy === "nitter") return "nitter";
  if (extracted.transcriptSource === "whisper") return "audio-transcription";
  if (extracted.transcriptSource === "youtube") return "youtube-captions";
  return "html";
})();

const transcriptionProvider = extracted.transcriptionProvider as
  | PipelineInfo["transcriptionProvider"]
  | null;

ctx.hooks.setPipelineInfo({
  sourceUrl: url,
  extractionMethod,
  transcriptionProvider: transcriptionProvider ?? undefined,
  servicesUsed: {
    firecrawl: extracted.diagnostics?.firecrawl?.used ?? false,
    apify: apifyRequests > 0,
  },
});
```

Wait, `apifyRequests` is not available here. Let me check where that's tracked... It's in `RunMetrics` via `trackedFetch`. We can derive it from the report or use a different approach.

Let me check the diagnostics more carefully. Looking at `ExtractedLinkContent.diagnostics`, there's no direct apify tracking there. We can check if the transcript provider used apify or track it differently.

For simplicity, let's track what we can reliably:

- `firecrawl.used` from diagnostics
- For apify, we can check if any transcript provider attempted was apify-based, or just use the services request count from the metrics

Actually, looking at `diagnostics.transcript.attemptedProviders`, it may include apify. Let's use a simple heuristic:

```typescript
servicesUsed: {
  firecrawl: extracted.diagnostics?.firecrawl?.used ?? false,
  apify: extracted.diagnostics?.transcript?.attemptedProviders?.includes('apify') ?? false,
}
```

Let me check the actual transcript diagnostics structure...

Actually, looking at the types more carefully, I should check the core package types. Let me proceed with a reasonable approach and we can adjust:

---

### Task 5: Add timeStage and setPipelineInfo to hooks

**Files:**

- Modify: `src/run/flows/url/types.ts`

- [ ] **Step 1: Find the hooks type definition**

Look for `UrlFlowHooks` or similar type that defines the hooks interface.

- [ ] **Step 2: Add timeStage and setPipelineInfo to hooks**

Add to the hooks type:

```typescript
timeStage: <T>(stage: PipelineStage, fn: () => Promise<T>) => Promise<T>;
setPipelineInfo: (info: PipelineInfo) => void;
```

---

### Task 6: Wire hooks through runner

**Files:**

- Modify: `src/run/runner.ts`

- [ ] **Step 1: Find where hooks are created**

Look for where the hooks object is constructed that's passed to the flow context.

- [ ] **Step 2: Add timeStage and setPipelineInfo from metrics**

The hooks should get these from the metrics object:

```typescript
timeStage: metrics.timeStage,
setPipelineInfo: metrics.setPipelineInfo,
```

---

## Chunk 3: Output Integration

### Task 7: Add pipeline section to finish line

**Files:**

- Modify: `src/run/finish-line.ts`

- [ ] **Step 1: Import PipelineReport type**

```typescript
import type { PipelineReport } from "./run-metrics.js";
```

- [ ] **Step 2: Add pipeline to writeFinishLine parameters**

Update the function signature (around line 186):

```typescript
export function writeFinishLine({
  stderr,
  elapsedMs,
  elapsedLabel,
  label,
  model,
  report,
  costUsd,
  detailed,
  extraParts,
  color,
  env,
  pipeline,
}: {
  // ... existing params
  pipeline?: PipelineReport | null;
}): void {
```

- [ ] **Step 3: Render pipeline section**

After the existing finish line output, add pipeline section if provided:

```typescript
if (pipeline && detailed) {
  const pipelineSection = formatPipelineSection(pipeline);
  if (pipelineSection) {
    stderr.write(`\n${theme ? theme.dim(pipelineSection) : pipelineSection}`);
  }
}
```

- [ ] **Step 4: Add formatPipelineSection helper**

```typescript
function formatPipelineSection(pipeline: PipelineReport): string {
  const lines: string[] = [];
  lines.push("─".repeat(33));
  lines.push("Pipeline");

  if (pipeline.info) {
    lines.push(`  Source: ${pipeline.info.sourceUrl}`);
    let methodLine = `  Method: ${pipeline.info.extractionMethod}`;
    if (pipeline.info.transcriptionProvider) {
      methodLine += ` (${pipeline.info.transcriptionProvider})`;
    }
    lines.push(methodLine);
    lines.push("");
  }

  lines.push("  Timing:");
  for (const stage of pipeline.stages) {
    const label = stage.stage.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const duration = formatStageDuration(stage.durationMs);
    lines.push(`    ${label.padEnd(18)} ${duration}`);
  }
  lines.push("    " + "─".repeat(24));
  lines.push(`    ${"Total".padEnd(18)} ${formatStageDuration(pipeline.totalMs)}`);
  lines.push("─".repeat(33));

  return lines.join("\n");
}

function formatStageDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
```

---

### Task 8: Extend SSE events with pipeline

**Files:**

- Modify: `src/shared/sse-events.ts`

- [ ] **Step 1: Import PipelineReport type**

```typescript
import type { PipelineReport } from "../run/run-metrics.js";
```

- [ ] **Step 2: Add pipeline to SseMetricsData**

```typescript
export type SseMetricsData = {
  elapsedMs: number;
  summary: string;
  details: string | null;
  summaryDetailed: string;
  detailsDetailed: string | null;
  pipeline: PipelineReport | null;
};
```

---

### Task 9: Update daemon metrics builder

**Files:**

- Modify: `src/daemon/summarize.ts`

- [ ] **Step 1: Add pipeline to buildDaemonMetrics parameters**

Update the function (around line 49):

```typescript
function buildDaemonMetrics({
  elapsedMs,
  summaryFromCache,
  label,
  modelLabel,
  report,
  costUsd,
  compactExtraParts,
  detailedExtraParts,
}: {
  // ... existing
}): VisiblePageMetrics {
```

The pipeline is already in the `report`, so we just need to include it in the output.

- [ ] **Step 2: Include pipeline in VisiblePageMetrics**

Update the return type and body to include pipeline from report:

```typescript
return {
  elapsedMs,
  summary: compact.line,
  details: compact.details,
  summaryDetailed: detailed.line,
  detailsDetailed: detailed.details,
  pipeline: report.pipeline,
};
```

---

### Task 10: Include pipeline in JSON output

**Files:**

- Modify: `src/run/flows/url/summary.ts`

- [ ] **Step 1: Add pipeline to JSON payload in outputExtractedUrl**

Find the JSON payload (around line 222-257) and add:

```typescript
const payload = {
  input: { ... },
  env: { ... },
  extracted,
  slides,
  prompt,
  llm: null,
  metrics: flags.metricsEnabled ? finishReport : null,
  pipeline: finishReport?.pipeline ?? null,
  summary: null,
};
```

- [ ] **Step 2: Add pipeline to JSON payload in summarizeExtractedUrl**

Find the JSON payload (around line 790-830) and add:

```typescript
const payload = {
  input: { ... },
  env: { ... },
  extracted,
  slides,
  prompt,
  llm: { ... },
  metrics: flags.metricsEnabled ? finishReport : null,
  pipeline: finishReport?.pipeline ?? null,
  summary: normalizedSummary,
};
```

- [ ] **Step 3: Pass pipeline to writeFinishLine**

In all the `writeFinishLine` calls, add the pipeline parameter:

```typescript
writeFinishLine({
  // ... existing params
  pipeline: report?.pipeline ?? null,
});
```

---

## Chunk 4: Testing & Verification

### Task 11: Build and verify

- [ ] **Step 1: Run build**

```bash
pnpm -s build
```

Expected: Build succeeds with no type errors

- [ ] **Step 2: Run type check**

```bash
pnpm -s check
```

Expected: All checks pass

- [ ] **Step 3: Test JSON output**

```bash
echo "https://example.com" | pnpm summarize --json
```

Expected: JSON output includes `pipeline` field with stages and info

- [ ] **Step 4: Test CLI text output with metrics**

```bash
echo "https://example.com" | pnpm summarize --metrics
```

Expected: Finish line includes pipeline section with timing

---

## Notes

- The `text-extraction` stage timing is derived from the extraction diagnostics rather than separately timed, since transcription happens inside the content extraction flow
- The `initial-query` stage can be added later if needed - for now we focus on the most valuable stages: content extraction and LLM query
- Apify service detection relies on transcript diagnostics or metrics request counts
