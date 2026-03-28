import type { CacheState } from "../../../cache.js";
import type {
  ExtractedLinkContent,
  LinkPreviewProgressEvent,
  MediaCache,
} from "../../../content/index.js";
import type { LlmCall, RunMetricsReport } from "../../../costs.js";
import type { StreamMode } from "../../../flags.js";
import type { OutputLanguage } from "../../../language.js";
import type { LiteLlmConnection } from "../../../llm/generate-text.js";
import type { ExecFileFn } from "../../../markitdown.js";
import type { SummaryLength } from "../../../shared/contracts.js";
import type {
  SlideExtractionResult,
  SlideImage,
  SlideSettings,
  SlideSourceKind,
} from "../../../slides/index.js";
import type { PipelineInfo, PipelineStage } from "../../run-metrics.js";
import type { createSummaryEngine } from "../../summary-engine.js";
import type { SummarizeAssetArgs } from "../asset/summary.js";

export type UrlFlowIo = {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  execFileImpl: ExecFileFn;
  fetch: typeof fetch;
};

export type UrlFlowFlags = {
  timeoutMs: number;
  maxExtractCharacters?: number | null;
  retries: number;
  format: "text" | "markdown";
  markdownMode: "off" | "auto" | "llm" | "readability";
  preprocessMode: "off" | "auto" | "always";
  youtubeMode: "auto" | "web" | "yt-dlp" | "apify" | "no-auto";
  firecrawlMode: "off" | "auto" | "always";
  videoMode: "auto" | "transcript" | "understand";
  transcriptTimestamps: boolean;
  outputLanguage: OutputLanguage;
  lengthArg: { kind: "preset"; preset: SummaryLength } | { kind: "chars"; maxCharacters: number };
  forceSummary: boolean;
  promptOverride?: string | null;
  lengthInstruction?: string | null;
  languageInstruction?: string | null;
  summaryCacheBypass: boolean;
  maxOutputTokensArg: number | null;
  json: boolean;
  extractMode: boolean;
  metricsEnabled: boolean;
  metricsDetailed: boolean;
  shouldComputeReport: boolean;
  runStartedAtMs: number;
  verbose: boolean;
  verboseColor: boolean;
  progressEnabled: boolean;
  streamMode: StreamMode;
  streamingEnabled: boolean;
  plain: boolean;
  configPath: string | null;
  configModelLabel: string | null;
  slides: SlideSettings | null;
  slidesDebug: boolean;
  slidesOutput?: boolean;
};

export type UrlFlowModel = {
  modelId: string;
  connection: LiteLlmConnection;
  desiredOutputTokens: number | null;
  summaryEngine: ReturnType<typeof createSummaryEngine>;
  getLiteLlmCatalog: () => Promise<
    Awaited<ReturnType<typeof import("../../../pricing/litellm.js").loadLiteLlmCatalog>>["catalog"]
  >;
  llmCalls: LlmCall[];
  /** Apify token for content extraction. */
  apifyToken: string | null;
  firecrawlConfigured: boolean;
  firecrawlApiKey: string | null;
  ytDlpPath: string | null;
  ytDlpCookiesFromBrowser: string | null;
};

export type UrlFlowHooks = {
  onModelChosen?: ((modelId: string) => void) | null;
  onExtracted?: ((extracted: ExtractedLinkContent) => void) | null;
  onSlidesExtracted?: ((slides: SlideExtractionResult) => void) | null;
  onSlidesProgress?: ((text: string) => void) | null;
  onSlidesDone?: ((result: { ok: boolean; error?: string | null }) => void) | null;
  onSlideChunk?: (chunk: {
    slide: SlideImage;
    meta: {
      slidesDir: string;
      sourceUrl: string;
      sourceId: string;
      sourceKind: SlideSourceKind;
      ocrAvailable: boolean;
    };
  }) => void;
  onLinkPreviewProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
  onSummaryCached?: ((cached: boolean) => void) | null;
  setTranscriptionCost: (costUsd: number | null, label: string | null) => void;
  summarizeAsset: (args: SummarizeAssetArgs) => Promise<void>;
  writeViaFooter: (parts: string[]) => void;
  clearProgressForStdout: () => void;
  restoreProgressAfterStdout?: (() => void) | null;
  setClearProgressBeforeStdout: (fn: (() => undefined | (() => void)) | null) => void;
  clearProgressIfCurrent: (fn: () => void) => void;
  buildReport: () => Promise<RunMetricsReport>;
  estimateCostUsd: () => Promise<number | null>;
  timeStage: <T>(stage: PipelineStage, fn: () => Promise<T>) => Promise<T>;
  setPipelineInfo: (info: PipelineInfo) => void;
};

/**
 * Wiring struct for `runUrlFlow`.
 * The server uses a subset of this surface (no TTY/progress/footer),
 * sharing the same extraction/cache/model logic.
 */
export type UrlFlowContext = {
  io: UrlFlowIo;
  flags: UrlFlowFlags;
  model: UrlFlowModel;
  cache: CacheState;
  mediaCache: MediaCache | null;
  hooks: UrlFlowHooks;
};
