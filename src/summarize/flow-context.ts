import { Writable } from "node:stream";
import type { CacheState } from "../cache.js";
import type {
  ExtractedLinkContent,
  LinkPreviewProgressEvent,
  MediaCache,
} from "../content/index.js";
import type { LiteLlmConnection } from "../llm/generate-text.js";
import type { ExecFileFn } from "../markitdown.js";
import { execFileTracked } from "../processes.js";
import type { AssetSummaryContext, SummarizeAssetArgs } from "../run/flows/asset/summary.js";
import { summarizeAsset as summarizeAssetFlow } from "../run/flows/asset/summary.js";
import type { UrlFlowContext } from "../run/flows/url/types.js";
import { resolveRunContextState } from "../run/run-context.js";
import { resolveEnvState } from "../run/run-env.js";
import { createRunMetrics } from "../run/run-metrics.js";
import { resolveModelSelection } from "../run/run-models.js";
import { resolveDesiredOutputTokens } from "../run/run-output.js";
import {
  type RunOverrides,
  resolveOutputLanguageSetting,
  resolveSummaryLength,
} from "../run/run-settings.js";
import { createSummaryEngine } from "../run/summary-engine.js";

type TextSink = {
  writeChunk: (text: string) => void;
};

function createWritableFromTextSink(sink: TextSink): NodeJS.WritableStream {
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const text =
        typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : "";
      if (text) sink.writeChunk(text);
      callback();
    },
  });
  return stream;
}

export type ServerUrlFlowContextArgs = {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  cache: CacheState;
  mediaCache?: MediaCache | null;
  modelOverride: string | null;
  promptOverride: string | null;
  lengthRaw: unknown;
  languageRaw: unknown;
  maxExtractCharacters: number | null;
  format?: "text" | "markdown";
  overrides?: RunOverrides | null;
  extractOnly?: boolean;
  hooks?: {
    onModelChosen?: ((modelId: string) => void) | null;
    onExtracted?: ((extracted: ExtractedLinkContent) => void) | null;
    onLinkPreviewProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
    onSummaryCached?: ((cached: boolean) => void) | null;
  } | null;
  runStartedAtMs: number;
  stdoutSink: TextSink;
};

export function createServerUrlFlowContext(args: ServerUrlFlowContextArgs): UrlFlowContext {
  const {
    env,
    fetchImpl,
    cache,
    mediaCache = null,
    modelOverride,
    promptOverride,
    lengthRaw,
    languageRaw,
    maxExtractCharacters,
    format,
    overrides,
    extractOnly,
    hooks,
    runStartedAtMs,
    stdoutSink,
  } = args;

  const envForRun: Record<string, string | undefined> = { ...env };

  const languageExplicitlySet = typeof languageRaw === "string" && Boolean(languageRaw.trim());

  const { lengthArg } = resolveSummaryLength(lengthRaw);
  const resolvedOverrides: RunOverrides = overrides ?? {
    firecrawlMode: null,
    markdownMode: null,
    preprocessMode: null,
    youtubeMode: null,
    videoMode: null,
    transcriptTimestamps: null,
    forceSummary: null,
    timeoutMs: null,
    retries: null,
    maxOutputTokensArg: null,
    transcriber: null,
  };
  if (resolvedOverrides.transcriber) {
    envForRun.SUMMARIZE_TRANSCRIBER = resolvedOverrides.transcriber;
  }
  const videoModeOverride = resolvedOverrides.videoMode;
  const resolvedFormat = format === "markdown" ? "markdown" : "text";

  const {
    config,
    configPath,
    outputLanguage: outputLanguageFromConfig,
    videoMode,
    configModelLabel,
  } = resolveRunContextState({
    env: envForRun,
    envForRun,
    programOpts: { videoMode: videoModeOverride ?? "auto" },
    languageExplicitlySet,
    videoModeExplicitlySet: videoModeOverride != null,
  });

  const envState = resolveEnvState({ env: envForRun, envForRun, config });

  const modelSelection = resolveModelSelection({
    config,
    envForRun,
    explicitModelArg: modelOverride?.trim() ? modelOverride.trim() : null,
  });

  const connection: LiteLlmConnection = {
    baseUrl: envState.litellmBaseUrl,
    apiKey: envState.litellmApiKey,
  };

  const maxOutputTokensArg = resolvedOverrides.maxOutputTokensArg;
  const desiredOutputTokens = resolveDesiredOutputTokens({ lengthArg, maxOutputTokensArg });

  const metrics = createRunMetrics({ env: envForRun, fetchImpl, maxOutputTokensArg });

  const stdout = createWritableFromTextSink(stdoutSink);
  const stderr = process.stderr;

  const timeoutMs = resolvedOverrides.timeoutMs ?? 120_000;
  const retries = resolvedOverrides.retries ?? 1;
  const firecrawlMode = resolvedOverrides.firecrawlMode ?? "off";
  const markdownMode =
    resolvedOverrides.markdownMode ?? (resolvedFormat === "markdown" ? "readability" : "off");
  const preprocessMode = resolvedOverrides.preprocessMode ?? "auto";
  const youtubeMode = resolvedOverrides.youtubeMode ?? "auto";

  const summaryEngine = createSummaryEngine({
    envForRun,
    stdout,
    stderr,
    timeoutMs,
    streamingEnabled: true,
    verbose: false,
    verboseColor: false,
    connection,
    modelId: modelSelection.modelId,
    resolveMaxOutputTokensForCall: metrics.resolveMaxOutputTokensForCall,
    resolveMaxInputTokensForCall: metrics.resolveMaxInputTokensForCall,
    llmCalls: metrics.llmCalls,
    clearProgressForStdout: () => {},
  });

  const outputLanguage = resolveOutputLanguageSetting({
    raw: languageRaw,
    fallback: outputLanguageFromConfig,
  });

  const lengthInstruction =
    promptOverride && lengthArg.kind === "chars"
      ? `Output is ${lengthArg.maxCharacters.toLocaleString()} characters.`
      : null;
  const languageExplicit =
    typeof languageRaw === "string" &&
    languageRaw.trim().length > 0 &&
    languageRaw.trim().toLowerCase() !== "auto";
  const languageInstruction =
    promptOverride && languageExplicit && outputLanguage.kind === "fixed"
      ? `Output should be ${outputLanguage.label}.`
      : null;

  const assetSummaryContext: AssetSummaryContext = {
    env: envForRun,
    envForRun,
    stdout,
    stderr,
    execFileImpl: execFileTracked as unknown as ExecFileFn,
    timeoutMs,
    preprocessMode,
    format: "text",
    extractMode: extractOnly ?? false,
    lengthArg,
    forceSummary: resolvedOverrides.forceSummary ?? false,
    outputLanguage,
    videoMode,
    promptOverride,
    lengthInstruction,
    languageInstruction,
    requestedModelLabel: modelSelection.modelId,
    maxOutputTokensArg,
    json: false,
    metricsEnabled: false,
    metricsDetailed: false,
    shouldComputeReport: false,
    runStartedAtMs,
    verbose: false,
    verboseColor: false,
    streamingEnabled: true,
    plain: true,
    summaryEngine,
    writeViaFooter: () => {},
    clearProgressForStdout: () => {},
    buildReport: metrics.buildReport,
    estimateCostUsd: metrics.estimateCostUsd,
    llmCalls: metrics.llmCalls,
    cache,
    summaryCacheBypass: false,
    mediaCache,
    apiStatus: {
      apifyToken: envState.apifyToken,
      firecrawlConfigured: envState.firecrawlConfigured,
    },
  };

  const ctx: UrlFlowContext = {
    io: {
      env: envForRun,
      envForRun,
      stdout,
      stderr,
      execFileImpl: execFileTracked as unknown as ExecFileFn,
      fetch: metrics.trackedFetch,
    },
    flags: {
      timeoutMs,
      maxExtractCharacters,
      retries,
      format: resolvedFormat,
      markdownMode,
      preprocessMode,
      youtubeMode,
      firecrawlMode,
      videoMode,
      transcriptTimestamps: resolvedOverrides.transcriptTimestamps ?? false,
      outputLanguage,
      lengthArg,
      forceSummary: resolvedOverrides.forceSummary ?? false,
      promptOverride,
      lengthInstruction,
      languageInstruction,
      summaryCacheBypass: false,
      maxOutputTokensArg,
      json: false,
      extractMode: extractOnly ?? false,
      metricsEnabled: false,
      metricsDetailed: false,
      shouldComputeReport: false,
      runStartedAtMs,
      verbose: false,
      verboseColor: false,
      progressEnabled: false,
      streamMode: "on",
      streamingEnabled: true,
      plain: true,
      configPath,
      configModelLabel,
    },
    model: {
      modelId: modelSelection.modelId,
      connection,
      desiredOutputTokens,
      summaryEngine,
      getLiteLlmCatalog: metrics.getLiteLlmCatalog,
      llmCalls: metrics.llmCalls,
      apifyToken: envState.apifyToken,
      firecrawlConfigured: envState.firecrawlConfigured,
      firecrawlApiKey: envState.firecrawlApiKey,
      ytDlpPath: envState.ytDlpPath,
      ytDlpCookiesFromBrowser: envState.ytDlpCookiesFromBrowser,
    },
    cache,
    mediaCache,
    hooks: {
      onModelChosen: hooks?.onModelChosen ?? null,
      onExtracted: hooks?.onExtracted ?? null,
      onLinkPreviewProgress: hooks?.onLinkPreviewProgress ?? null,
      onSummaryCached: hooks?.onSummaryCached ?? null,
      setTranscriptionCost: metrics.setTranscriptionCost,
      summarizeAsset: (assetArgs: SummarizeAssetArgs) =>
        summarizeAssetFlow(assetSummaryContext, assetArgs),
      writeViaFooter: () => {},
      clearProgressForStdout: () => {},
      setClearProgressBeforeStdout: () => {},
      clearProgressIfCurrent: () => {},
      buildReport: metrics.buildReport,
      estimateCostUsd: metrics.estimateCostUsd,
      timeStage: metrics.timeStage,
      setPipelineInfo: metrics.setPipelineInfo,
    },
  };

  return ctx;
}
