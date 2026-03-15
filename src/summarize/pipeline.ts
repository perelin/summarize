import path from "node:path";
import type { CacheState } from "../cache.js";
import { type ExtractedLinkContent, isYouTubeUrl, type MediaCache } from "../content/index.js";
import {
  countWords,
  estimateDurationSecondsFromWords,
  formatInputSummary,
  formatProgress,
} from "../core/summarize/index.js";
import type { RunMetricsReport } from "../costs.js";
import { buildFinishLineVariants, buildLengthPartsForFinishLine } from "../run/finish-line.js";
import { deriveExtractionUi } from "../run/flows/url/extract.js";
import { runUrlFlow } from "../run/flows/url/flow.js";
import { buildUrlPrompt, summarizeExtractedUrl } from "../run/flows/url/summary.js";
import type { PipelineReport } from "../run/run-metrics.js";
import type { RunOverrides } from "../run/run-settings.js";
import type { SummarizeInsights } from "../server/types.js";
import type {
  SlideExtractionResult,
  SlideImage,
  SlideSettings,
  SlideSourceKind,
} from "../slides/index.js";
import { createServerUrlFlowContext } from "./flow-context.js";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

/**
 * If the URL has a `.pdf` extension, download and extract text via pdf-parse.
 * Returns null for non-PDF URLs so the caller can fall through to the normal flow.
 */
async function tryExtractPdfUrl({
  url,
  fetchImpl,
  timeoutMs,
}: {
  url: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<{ text: string; filename: string } | null> {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!pathname.toLowerCase().endsWith(".pdf")) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Failed to download PDF (HTTP ${res.status})`);
    }
    const contentLength = res.headers.get("content-length");
    if (contentLength) {
      const size = Number(contentLength);
      if (Number.isFinite(size) && size > MAX_PDF_BYTES) {
        throw new Error(`PDF too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`);
      }
    }
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_PDF_BYTES) {
      throw new Error(
        `PDF too large (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`,
      );
    }

    const { PDFParse } = await import("pdf-parse");
    const pdf = new PDFParse({ data: new Uint8Array(arrayBuffer) });
    const result = await pdf.getText();
    const text = result.text?.trim();
    await pdf.destroy();
    if (!text) {
      throw new Error("PDF appears to contain only images or no extractable text.");
    }

    const filename = path.basename(pathname) || "document.pdf";
    return { text, filename };
  } finally {
    clearTimeout(timeout);
  }
}

function buildPdfExtracted({
  url,
  text,
  filename,
  cacheMode,
}: {
  url: string;
  text: string;
  filename: string;
  cacheMode: "default" | "bypass";
}): ExtractedLinkContent {
  return {
    url,
    title: filename,
    description: null,
    siteName: null,
    content: text,
    truncated: false,
    totalCharacters: text.length,
    wordCount: countWords(text),
    transcriptCharacters: null,
    transcriptLines: null,
    transcriptWordCount: null,
    transcriptSource: null,
    transcriptionProvider: null,
    transcriptMetadata: null,
    transcriptSegments: null,
    transcriptTimedText: null,
    mediaDurationSeconds: null,
    video: null,
    isVideoOnly: false,
    diagnostics: {
      strategy: "html",
      firecrawl: {
        attempted: false,
        used: false,
        cacheMode,
        cacheStatus: "unknown",
      },
      markdown: {
        requested: false,
        used: false,
        provider: null,
      },
      transcript: {
        cacheMode,
        cacheStatus: "unknown",
        textProvided: false,
        provider: null,
        attemptedProviders: [],
      },
    },
  };
}

export type TextInput = {
  url: string;
  title: string | null;
  text: string;
  truncated: boolean;
};

export type UrlModeInput = {
  url: string;
  title: string | null;
  maxCharacters: number | null;
};

export type StreamSink = {
  writeChunk: (text: string) => void;
  onModelChosen: (modelId: string) => void;
  writeStatus?: ((text: string) => void) | null;
  writeMeta?:
    | ((data: { inputSummary?: string | null; summaryFromCache?: boolean | null }) => void)
    | null;
};

export type TextSummaryMetrics = {
  elapsedMs: number;
  summary: string;
  details: string | null;
  summaryDetailed: string;
  detailsDetailed: string | null;
  pipeline: PipelineReport | null;
};

function buildPipelineMetrics({
  elapsedMs,
  summaryFromCache,
  label,
  modelLabel,
  report,
  costUsd,
  compactExtraParts,
  detailedExtraParts,
}: {
  elapsedMs: number;
  summaryFromCache: boolean;
  label: string | null;
  modelLabel: string;
  report: RunMetricsReport;
  costUsd: number | null;
  compactExtraParts: string[] | null;
  detailedExtraParts: string[] | null;
}): TextSummaryMetrics {
  const elapsedLabel = summaryFromCache ? "Cached" : null;
  const { compact, detailed } = buildFinishLineVariants({
    elapsedMs,
    elapsedLabel,
    label,
    model: modelLabel,
    report,
    costUsd,
    compactExtraParts,
    detailedExtraParts,
  });

  return {
    elapsedMs,
    summary: compact.line,
    details: compact.details,
    summaryDetailed: detailed.line,
    detailsDetailed: detailed.details,
    pipeline: report.pipeline,
  };
}

function guessSiteName(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return hostname || null;
  } catch {
    return null;
  }
}

function buildInputSummaryForExtracted(extracted: ExtractedLinkContent): string | null {
  const isYouTube = extracted.siteName === "YouTube" || isYouTubeUrl(extracted.url);

  const transcriptChars =
    typeof extracted.transcriptCharacters === "number" && extracted.transcriptCharacters > 0
      ? extracted.transcriptCharacters
      : null;
  const hasTranscript = transcriptChars != null;

  const transcriptWords =
    hasTranscript && transcriptChars != null
      ? (extracted.transcriptWordCount ?? Math.max(0, Math.round(transcriptChars / 6)))
      : null;

  const exactDurationSeconds =
    typeof extracted.mediaDurationSeconds === "number" && extracted.mediaDurationSeconds > 0
      ? extracted.mediaDurationSeconds
      : null;
  const estimatedDurationSeconds =
    transcriptWords != null && transcriptWords > 0
      ? estimateDurationSecondsFromWords(transcriptWords)
      : null;

  const durationSeconds = hasTranscript ? (exactDurationSeconds ?? estimatedDurationSeconds) : null;
  const isDurationApproximate =
    hasTranscript && durationSeconds != null && exactDurationSeconds == null;

  const kindLabel = (() => {
    if (isYouTube) return "YouTube";
    if (!hasTranscript) return null;
    if (extracted.isVideoOnly || extracted.video) return "video";
    return "podcast";
  })();

  return formatInputSummary({
    kindLabel,
    durationSeconds,
    words: hasTranscript ? transcriptWords : extracted.wordCount,
    characters: hasTranscript ? transcriptChars : extracted.totalCharacters,
    isDurationApproximate,
  });
}

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

export async function streamSummaryForText({
  env,
  fetchImpl,
  input,
  modelOverride,
  promptOverride,
  lengthRaw,
  languageRaw,
  format,
  sink,
  cache,
  mediaCache,
  overrides,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  input: TextInput;
  modelOverride: string | null;
  promptOverride: string | null;
  lengthRaw: unknown;
  languageRaw: unknown;
  format?: "text" | "markdown";
  sink: StreamSink;
  cache: CacheState;
  mediaCache: MediaCache | null;
  overrides: RunOverrides;
}): Promise<{
  usedModel: string;
  report: RunMetricsReport;
  metrics: TextSummaryMetrics;
  insights: SummarizeInsights | null;
}> {
  const startedAt = Date.now();
  let usedModel: string | null = null;
  let summaryFromCache = false;

  const writeStatus = typeof sink.writeStatus === "function" ? sink.writeStatus : null;

  const ctx = createServerUrlFlowContext({
    env,
    fetchImpl,
    cache,
    mediaCache,
    modelOverride,
    promptOverride,
    lengthRaw,
    languageRaw,
    maxExtractCharacters: null,
    format,
    overrides,
    hooks: {
      onModelChosen: (modelId) => {
        usedModel = modelId;
        sink.onModelChosen(modelId);
      },
      onSummaryCached: (cached) => {
        summaryFromCache = cached;
        sink.writeMeta?.({ summaryFromCache: cached });
      },
    },
    runStartedAtMs: startedAt,
    stdoutSink: { writeChunk: sink.writeChunk },
  });

  const extracted: ExtractedLinkContent = {
    url: input.url,
    title: input.title,
    description: null,
    siteName: guessSiteName(input.url),
    content: input.text,
    truncated: input.truncated,
    totalCharacters: input.text.length,
    wordCount: countWords(input.text),
    transcriptCharacters: null,
    transcriptLines: null,
    transcriptWordCount: null,
    transcriptSource: null,
    transcriptionProvider: null,
    transcriptMetadata: null,
    transcriptSegments: null,
    transcriptTimedText: null,
    mediaDurationSeconds: null,
    video: null,
    isVideoOnly: false,
    diagnostics: {
      strategy: "html",
      firecrawl: {
        attempted: false,
        used: false,
        cacheMode: cache.mode,
        cacheStatus: "unknown",
      },
      markdown: {
        requested: false,
        used: false,
        provider: null,
      },
      transcript: {
        cacheMode: cache.mode,
        cacheStatus: "unknown",
        textProvided: false,
        provider: null,
        attemptedProviders: [],
      },
    } satisfies ExtractedLinkContent["diagnostics"],
  };

  sink.writeMeta?.({
    inputSummary: formatInputSummary({
      kindLabel: null,
      durationSeconds: null,
      words: extracted.wordCount,
      characters: extracted.totalCharacters,
    }),
  });
  writeStatus?.("Summarizing…");

  const extractionUi = deriveExtractionUi(extracted);
  const prompt = buildUrlPrompt({
    extracted,
    outputLanguage: ctx.flags.outputLanguage,
    lengthArg: ctx.flags.lengthArg,
    promptOverride: ctx.flags.promptOverride ?? null,
    lengthInstruction: ctx.flags.lengthInstruction ?? null,
    languageInstruction: ctx.flags.languageInstruction ?? null,
  });

  await summarizeExtractedUrl({
    ctx,
    url: input.url,
    extracted,
    extractionUi,
    prompt,
    effectiveMarkdownMode: "off",
    transcriptionCostLabel: null,
    onModelChosen: ctx.hooks.onModelChosen ?? null,
  });

  const report = await ctx.hooks.buildReport();
  const costUsd = await ctx.hooks.estimateCostUsd();
  const elapsedMs = Date.now() - startedAt;

  const label = extracted.siteName ?? guessSiteName(extracted.url);
  const modelLabel = usedModel ?? ctx.model.requestedModelLabel;
  const usage = report.llm[0] ?? null;
  return {
    usedModel: modelLabel,
    report,
    metrics: buildPipelineMetrics({
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
}

export async function streamSummaryForUrl({
  env,
  fetchImpl,
  input,
  modelOverride,
  promptOverride,
  lengthRaw,
  languageRaw,
  format,
  sink,
  cache,
  mediaCache,
  overrides,
  slides,
  hooks,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  input: UrlModeInput;
  modelOverride: string | null;
  promptOverride: string | null;
  lengthRaw: unknown;
  languageRaw: unknown;
  format?: "text" | "markdown";
  sink: StreamSink;
  cache: CacheState;
  mediaCache: MediaCache | null;
  overrides: RunOverrides;
  slides?: SlideSettings | null;
  hooks?: {
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
  } | null;
}): Promise<{
  usedModel: string;
  report: RunMetricsReport;
  metrics: TextSummaryMetrics;
  insights: SummarizeInsights;
  extracted: ExtractedLinkContent;
}> {
  const startedAt = Date.now();
  const writeStatus = typeof sink.writeStatus === "function" ? sink.writeStatus : null;

  // ---- PDF URL shortcut: download + extract text, bypass HTML fetch ----
  const pdfResult = await tryExtractPdfUrl({
    url: input.url,
    fetchImpl,
    timeoutMs: overrides.timeoutMs ?? 300_000,
  });
  if (pdfResult) {
    writeStatus?.("Extracting text from PDF…");
    const extracted = buildPdfExtracted({
      url: input.url,
      text: pdfResult.text,
      filename: pdfResult.filename,
      cacheMode: cache.mode,
    });
    hooks?.onExtracted?.(extracted);

    const visibleResult = await streamSummaryForText({
      env,
      fetchImpl,
      input: {
        url: input.url,
        title: pdfResult.filename,
        text: pdfResult.text,
        truncated: false,
      },
      modelOverride,
      promptOverride,
      lengthRaw,
      languageRaw,
      format,
      sink,
      cache,
      mediaCache,
      overrides,
    });

    return {
      ...visibleResult,
      insights:
        visibleResult.insights ??
        buildInsightsForExtracted({
          extracted,
          report: visibleResult.report,
          costUsd: null,
          summaryFromCache: false,
        }),
      extracted,
    };
  }

  // ---- Standard URL flow ----
  let usedModel: string | null = null;
  let summaryFromCache = false;
  const extractedRef = { value: null as ExtractedLinkContent | null };

  const ctx = createServerUrlFlowContext({
    env,
    fetchImpl,
    cache,
    mediaCache,
    modelOverride,
    promptOverride,
    lengthRaw,
    languageRaw,
    maxExtractCharacters:
      input.maxCharacters && input.maxCharacters > 0 ? input.maxCharacters : null,
    format,
    overrides,
    slides,
    hooks: {
      onModelChosen: (modelId) => {
        usedModel = modelId;
        sink.onModelChosen(modelId);
      },
      onExtracted: (content) => {
        extractedRef.value = content;
        hooks?.onExtracted?.(content);
        sink.writeMeta?.({ inputSummary: buildInputSummaryForExtracted(content) });
        writeStatus?.("Summarizing…");
      },
      onSlidesExtracted: (result) => {
        hooks?.onSlidesExtracted?.(result);
      },
      onSlidesDone: (result) => {
        hooks?.onSlidesDone?.(result);
      },
      onSlideChunk: hooks?.onSlideChunk ?? undefined,
      onSlidesProgress: (text: string) => {
        const trimmed = typeof text === "string" ? text.trim() : "";
        if (!trimmed) return;
        hooks?.onSlidesProgress?.(trimmed);
        writeStatus?.(trimmed);
      },
      onLinkPreviewProgress: (event) => {
        const msg = formatProgress(event);
        if (msg) writeStatus?.(msg);
      },
      onSummaryCached: (cached) => {
        summaryFromCache = cached;
        sink.writeMeta?.({ summaryFromCache: cached });
      },
    },
    runStartedAtMs: startedAt,
    stdoutSink: { writeChunk: sink.writeChunk },
  });

  writeStatus?.("Extracting…");
  await runUrlFlow({ ctx, url: input.url, isYoutubeUrl: isYouTubeUrl(input.url) });

  const extracted = extractedRef.value;
  if (!extracted) {
    throw new Error("Internal error: missing extracted content");
  }

  const report = await ctx.hooks.buildReport();
  const costUsd = await ctx.hooks.estimateCostUsd();
  const elapsedMs = Date.now() - startedAt;

  const label = extracted.siteName ?? guessSiteName(extracted.url);
  const modelLabel = usedModel ?? ctx.model.requestedModelLabel;
  const compactExtraParts = buildLengthPartsForFinishLine(extracted, false);
  const detailedExtraParts = buildLengthPartsForFinishLine(extracted, true);

  return {
    usedModel: modelLabel,
    report,
    metrics: buildPipelineMetrics({
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
    extracted,
  };
}

export async function extractContentForUrl({
  env,
  fetchImpl,
  input,
  cache,
  mediaCache,
  overrides,
  format,
  slides,
  hooks,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  input: UrlModeInput;
  cache: CacheState;
  mediaCache: MediaCache | null;
  overrides: RunOverrides;
  format?: "text" | "markdown";
  slides?: SlideSettings | null;
  hooks?: {
    onSlidesExtracted?: ((slides: SlideExtractionResult) => void) | null;
  } | null;
}): Promise<{ extracted: ExtractedLinkContent; slides: SlideExtractionResult | null }> {
  // ---- PDF URL shortcut ----
  const pdfResult = await tryExtractPdfUrl({
    url: input.url,
    fetchImpl,
    timeoutMs: overrides.timeoutMs ?? 300_000,
  });
  if (pdfResult) {
    const extracted = buildPdfExtracted({
      url: input.url,
      text: pdfResult.text,
      filename: pdfResult.filename,
      cacheMode: cache.mode,
    });
    return { extracted, slides: null };
  }

  const extractedRef = { value: null as ExtractedLinkContent | null };
  const slidesRef = { value: null as SlideExtractionResult | null };

  const ctx = createServerUrlFlowContext({
    env,
    fetchImpl,
    cache,
    mediaCache,
    modelOverride: null,
    promptOverride: null,
    lengthRaw: "",
    languageRaw: "",
    maxExtractCharacters:
      input.maxCharacters && input.maxCharacters > 0 ? input.maxCharacters : null,
    format,
    overrides,
    extractOnly: true,
    slides,
    hooks: {
      onExtracted: (content) => {
        extractedRef.value = content;
      },
      onSlidesExtracted: (result) => {
        slidesRef.value = result;
        hooks?.onSlidesExtracted?.(result);
      },
    },
    runStartedAtMs: Date.now(),
    stdoutSink: { writeChunk: () => {} },
  });

  await runUrlFlow({ ctx, url: input.url, isYoutubeUrl: isYouTubeUrl(input.url) });

  const extracted = extractedRef.value;
  if (!extracted) {
    throw new Error("Internal error: missing extracted content");
  }

  return { extracted, slides: slidesRef.value };
}
