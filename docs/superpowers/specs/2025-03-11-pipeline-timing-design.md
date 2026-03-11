# Pipeline Timing & Info Feature

**Date:** 2025-03-11
**Status:** Approved

## Goal

Output original source link, extraction method, and per-stage timing for all summarize operations.

## Approach

Extend existing `RunMetrics` class with pipeline telemetry. This reuses existing infrastructure and keeps all metrics in one place.

## Data Types

### New types in `src/run/run-metrics.ts`

```typescript
type PipelineStage =
  | "initial-query" // URL resolution, cache check
  | "content-extraction" // Firecrawl, Apify, HTML fetch
  | "text-extraction" // Transcript/caption extraction
  | "llm-query"; // LLM summarization

type StageTiming = {
  stage: PipelineStage;
  durationMs: number;
};

type PipelineInfo = {
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
  transcriptionProvider?: "openai-whisper" | "youtube-captions" | "deepgram";
  servicesUsed: {
    firecrawl: boolean;
    apify: boolean;
  };
};

type PipelineReport = {
  stages: StageTiming[];
  totalMs: number;
  info: PipelineInfo;
};
```

### Extended `RunMetricsReport` in `src/costs.ts`

```typescript
type RunMetricsReport = {
  llm: Array<{...}>;
  services: {...};
  pipeline: PipelineReport;  // NEW
};
```

## Timing Collection

### Extend `RunMetrics` class

```typescript
class RunMetrics {
  // Existing fields...
  private stageTimings: Map<PipelineStage, number> = new Map();
  private stageStartTimes: Map<PipelineStage, number> = new Map();
  private pipelineInfo: PipelineInfo | null = null;

  // New methods
  startStage(stage: PipelineStage): void;
  endStage(stage: PipelineStage): void;
  setPipelineInfo(info: PipelineInfo): void;

  // Wrap async operations
  async timeStage<T>(stage: PipelineStage, fn: () => Promise<T>): Promise<T>;
}
```

### Usage in `src/run/flows/url/flow.ts`

```typescript
// Initial query
await metrics.timeStage('initial-query', async () => {
  // URL resolution, cache check
});

// Content extraction
await metrics.timeStage('content-extraction', async () => {
  extracted = await fetchWithCache(...);
});

// Text extraction (if applicable)
if (needsTranscription) {
  await metrics.timeStage('text-extraction', async () => {
    // Transcription/caption extraction
  });
}

// LLM query
await metrics.timeStage('llm-query', async () => {
  await summarizeExtractedUrl(...);
});
```

### PipelineInfo Population

- `sourceUrl` from input URL
- `extractionMethod` from `diagnostics.strategy`
- `transcriptionProvider` from `diagnostics.transcript.provider`
- `servicesUsed` from `diagnostics.firecrawl.used` / Apify tracking

## Output Formats

### JSON output (`--json` flag)

```json
{
  "input": {...},
  "extracted": {...},
  "pipeline": {
    "stages": [
      { "stage": "initial-query", "durationMs": 45 },
      { "stage": "content-extraction", "durationMs": 1230 },
      { "stage": "text-extraction", "durationMs": 8500 },
      { "stage": "llm-query", "durationMs": 4500 }
    ],
    "totalMs": 14275,
    "info": {
      "sourceUrl": "https://youtube.com/watch?v=abc123",
      "extractionMethod": "audio-transcription",
      "transcriptionProvider": "openai-whisper",
      "servicesUsed": { "firecrawl": false, "apify": false }
    }
  },
  "metrics": {...},
  "summary": "..."
}
```

### SSE events (daemon)

Extend `SseMetricsData` in `src/shared/sse-events.ts`:

```typescript
type SseMetricsData = {
  elapsedMs: number;
  pipeline: PipelineReport; // NEW
  // existing fields...
};
```

### CLI text output

Dedicated section after summary:

```
─────────────────────────────────
Pipeline
  Source: https://youtube.com/watch?v=abc123
  Method: audio-transcription (openai-whisper)

  Timing:
    initial-query:      45ms
    content-extraction: 1.2s
    text-extraction:    8.5s
    llm-query:          4.5s
    ────────────────────────
    total:              14.3s
─────────────────────────────────
```

## Error Handling

**Partial timing:**

- If a stage fails, still record elapsed time up to failure
- Stages not reached are omitted from output

**Missing info:**

- `transcriptionProvider` is optional — only set when audio/captions used
- `servicesUsed` defaults to `{ firecrawl: false, apify: false }`
- If `pipelineInfo` not set, output `pipeline: null` in JSON

**Cache hits:**

- `initial-query` includes cache lookup time
- `content-extraction` would be fast (cache read) — informative, not a bug

**Multiple LLM calls:**

- `llm-query` covers entire `summarizeExtractedUrl()` call
- Detailed per-call timing already in `metrics.llm` array

**Display thresholds:**

- Under 1s: show as `45ms`
- Over 1s: show as `1.2s`
- Total always shown in seconds with one decimal

## Files to Change

| File                           | Change                                          |
| ------------------------------ | ----------------------------------------------- |
| `src/run/run-metrics.ts`       | Add stage timing methods, `PipelineInfo` field  |
| `src/costs.ts`                 | Extend `RunMetricsReport` with `pipeline` field |
| `src/run/flows/url/flow.ts`    | Wrap stages with `metrics.timeStage()`          |
| `src/run/finish-line.ts`       | Add pipeline section display                    |
| `src/shared/sse-events.ts`     | Extend `SseMetricsData` with pipeline           |
| `src/run/flows/url/summary.ts` | Include pipeline in JSON output                 |
