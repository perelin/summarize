/**
 * Pipeline stage identifiers for timing instrumentation.
 *
 * Inlined from `src/run/run-metrics.ts` so that the SSE event types are
 * self-contained in `@steipete/summarize_p2-core` without pulling in
 * root-package dependencies.
 */
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

export type SseMetaData = {
  model: string | null;
  modelLabel: string | null;
  inputSummary: string | null;
  summaryFromCache?: boolean | null;
};

export type SseSlidesData = {
  sourceUrl: string;
  sourceId: string;
  sourceKind: string;
  ocrAvailable: boolean;
  slides: Array<{
    index: number;
    timestamp: number;
    imageUrl: string;
    ocrText?: string | null;
    ocrConfidence?: number | null;
  }>;
};

export type SseMetricsData = {
  elapsedMs: number;
  summary: string;
  details: string | null;
  summaryDetailed: string;
  detailsDetailed: string | null;
  pipeline: PipelineReport | null;
};

export type SseEvent =
  | { event: "init"; data: { summaryId: string } }
  | { event: "meta"; data: SseMetaData }
  | { event: "slides"; data: SseSlidesData }
  | { event: "status"; data: { text: string } }
  | { event: "chunk"; data: { text: string } }
  | { event: "metrics"; data: SseMetricsData }
  | { event: "done"; data: { summaryId: string } }
  | { event: "error"; data: { message: string; code?: string } };

export type RawSseMessage = { event: string; data: string };

export function encodeSseEvent(event: SseEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export function parseSseEvent(message: RawSseMessage): SseEvent | null {
  switch (message.event) {
    case "init":
      return { event: "init", data: JSON.parse(message.data) as { summaryId: string } };
    case "meta":
      return { event: "meta", data: JSON.parse(message.data) as SseMetaData };
    case "slides":
      return { event: "slides", data: JSON.parse(message.data) as SseSlidesData };
    case "status":
      return { event: "status", data: JSON.parse(message.data) as { text: string } };
    case "chunk":
      return { event: "chunk", data: JSON.parse(message.data) as { text: string } };
    case "metrics":
      return { event: "metrics", data: JSON.parse(message.data) as SseMetricsData };
    case "done":
      return { event: "done", data: JSON.parse(message.data) as { summaryId: string } };
    case "error":
      return { event: "error", data: JSON.parse(message.data) as { message: string; code?: string } };
    default:
      return null;
  }
}
