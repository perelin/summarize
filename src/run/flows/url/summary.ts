import { countTokens } from "gpt-tokenizer";
import {
  buildLanguageKey,
  buildLengthKey,
  buildPromptContentHash,
  buildPromptHash,
  buildSummaryCacheKey,
} from "../../../cache.js";
import type { ExtractedLinkContent } from "../../../content/index.js";
import { isYouTubeUrl } from "../../../core/content/url.js";
import { formatOutputLanguageForJson } from "../../../language.js";
import type { Prompt } from "../../../llm/prompt.js";
import { SUMMARY_SYSTEM_PROMPT } from "../../../prompts/index.js";
import { buildExtractFinishLabel, writeFinishLine } from "../../finish-line.js";
import { writeVerbose } from "../../logging.js";
import type { UrlExtractionUi } from "./extract.js";
import { normalizeSummarySlideHeadings } from "./slides-text.js";
import { buildFinishExtras, pickModelForFinishLine } from "./summary-finish.js";
import {
  buildUrlPrompt as buildSummaryPrompt,
  shouldBypassShortContentSummary,
} from "./summary-prompt.js";
import {
  buildSummaryTimestampLimitInstruction,
  resolveSummaryTimestampUpperBound,
  sanitizeSummaryKeyMoments,
  shouldSanitizeSummaryKeyMoments,
} from "./summary-timestamps.js";
import type { UrlFlowContext } from "./types.js";

type SlidesResult = Awaited<
  ReturnType<typeof import("../../../slides/index.js").extractSlidesForSource>
>;

export function buildUrlPrompt({
  extracted,
  outputLanguage,
  lengthArg,
  promptOverride,
  lengthInstruction,
  languageInstruction,
  slides,
}: {
  extracted: ExtractedLinkContent;
  outputLanguage: UrlFlowContext["flags"]["outputLanguage"];
  lengthArg: UrlFlowContext["flags"]["lengthArg"];
  promptOverride?: string | null;
  lengthInstruction?: string | null;
  languageInstruction?: string | null;
  slides?: SlidesResult | null;
}): string {
  return buildSummaryPrompt({
    extracted,
    outputLanguage,
    lengthArg,
    promptOverride,
    lengthInstruction,
    languageInstruction,
    slides,
    buildSummaryTimestampLimitInstruction,
  });
}

async function outputSummaryFromExtractedContent({
  ctx,
  url,
  extracted,
  extractionUi,
  prompt,
  effectiveMarkdownMode,
  transcriptionCostLabel,
  slides,
  footerLabel,
  verboseMessage,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  extractionUi: UrlExtractionUi;
  prompt: string;
  effectiveMarkdownMode: "off" | "auto" | "llm" | "readability";
  transcriptionCostLabel: string | null;
  slides?: Awaited<
    ReturnType<typeof import("../../../slides/index.js").extractSlidesForSource>
  > | null;
  footerLabel?: string | null;
  verboseMessage?: string | null;
}) {
  const { io, flags, model, hooks } = ctx;

  hooks.clearProgressForStdout();
  const finishModel = pickModelForFinishLine(model.llmCalls, null);

  if (flags.json) {
    const finishReport = flags.shouldComputeReport ? await hooks.buildReport() : null;
    const payload = {
      input: {
        kind: "url" as const,
        url,
        timeoutMs: flags.timeoutMs,
        youtube: flags.youtubeMode,
        firecrawl: flags.firecrawlMode,
        format: flags.format,
        markdown: effectiveMarkdownMode,
        timestamps: flags.transcriptTimestamps,
        length:
          flags.lengthArg.kind === "preset"
            ? { kind: "preset" as const, preset: flags.lengthArg.preset }
            : { kind: "chars" as const, maxCharacters: flags.lengthArg.maxCharacters },
        maxOutputTokens: flags.maxOutputTokensArg,
        model: model.modelId,
        language: formatOutputLanguageForJson(flags.outputLanguage),
      },
      env: {
        hasApifyToken: Boolean(model.apifyToken),
        hasFirecrawlKey: model.firecrawlConfigured,
      },
      extracted,
      slides,
      prompt,
      llm: null,
      metrics: flags.metricsEnabled ? finishReport : null,
      pipeline: finishReport?.pipeline ?? null,
      summary: extracted.content,
    };
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (flags.metricsEnabled && finishReport) {
      const costUsd = await hooks.estimateCostUsd();
      hooks.clearProgressForStdout();
      writeFinishLine({
        stderr: io.stderr,
        env: io.envForRun,
        elapsedMs: Date.now() - flags.runStartedAtMs,
        label: extractionUi.finishSourceLabel,
        model: finishModel,
        report: finishReport,
        costUsd,
        detailed: flags.metricsDetailed,
        extraParts: buildFinishExtras({
          extracted,
          metricsDetailed: flags.metricsDetailed,
          transcriptionCostLabel,
        }),
        color: flags.verboseColor,
        pipeline: finishReport?.pipeline ?? null,
      });
    }
    return;
  }

  io.stdout.write(`${extracted.content}\n`);
  hooks.restoreProgressAfterStdout?.();
  if (extractionUi.footerParts.length > 0) {
    const footer = footerLabel
      ? [...extractionUi.footerParts, footerLabel]
      : extractionUi.footerParts;
    hooks.writeViaFooter(footer);
  }
  if (verboseMessage && flags.verbose) {
    writeVerbose(io.stderr, flags.verbose, verboseMessage, flags.verboseColor, io.envForRun);
  }
}

export async function outputExtractedUrl({
  ctx,
  url,
  extracted,
  extractionUi,
  prompt,
  effectiveMarkdownMode,
  transcriptionCostLabel,
  slides,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  extractionUi: UrlExtractionUi;
  prompt: string;
  effectiveMarkdownMode: "off" | "auto" | "llm" | "readability";
  transcriptionCostLabel: string | null;
  slides?: Awaited<
    ReturnType<typeof import("../../../slides/index.js").extractSlidesForSource>
  > | null;
}) {
  const { io, flags, model, hooks } = ctx;

  hooks.clearProgressForStdout();
  const finishLabel = buildExtractFinishLabel({
    extracted: { diagnostics: extracted.diagnostics },
    format: flags.format,
    markdownMode: effectiveMarkdownMode,
    hasMarkdownLlmCall: model.llmCalls.some((call) => call.purpose === "markdown"),
  });
  const finishModel = pickModelForFinishLine(model.llmCalls, null);

  if (flags.json) {
    const finishReport = flags.shouldComputeReport ? await hooks.buildReport() : null;
    const payload = {
      input: {
        kind: "url" as const,
        url,
        timeoutMs: flags.timeoutMs,
        youtube: flags.youtubeMode,
        firecrawl: flags.firecrawlMode,
        format: flags.format,
        markdown: effectiveMarkdownMode,
        timestamps: flags.transcriptTimestamps,
        length:
          flags.lengthArg.kind === "preset"
            ? { kind: "preset" as const, preset: flags.lengthArg.preset }
            : { kind: "chars" as const, maxCharacters: flags.lengthArg.maxCharacters },
        maxOutputTokens: flags.maxOutputTokensArg,
        model: model.modelId,
        language: formatOutputLanguageForJson(flags.outputLanguage),
      },
      env: {
        hasApifyToken: Boolean(model.apifyToken),
        hasFirecrawlKey: model.firecrawlConfigured,
      },
      extracted,
      slides,
      prompt,
      llm: null,
      metrics: flags.metricsEnabled ? finishReport : null,
      pipeline: finishReport?.pipeline ?? null,
      summary: null,
    };
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    hooks.restoreProgressAfterStdout?.();
    if (flags.metricsEnabled && finishReport) {
      const costUsd = await hooks.estimateCostUsd();
      writeFinishLine({
        stderr: io.stderr,
        env: io.envForRun,
        elapsedMs: Date.now() - flags.runStartedAtMs,
        label: finishLabel,
        model: finishModel,
        report: finishReport,
        costUsd,
        detailed: flags.metricsDetailed,
        extraParts: buildFinishExtras({
          extracted,
          metricsDetailed: flags.metricsDetailed,
          transcriptionCostLabel,
        }),
        color: flags.verboseColor,
        pipeline: finishReport?.pipeline ?? null,
      });
    }
    return;
  }

  const extractCandidate =
    flags.transcriptTimestamps &&
    extracted.transcriptTimedText &&
    extracted.transcriptSource &&
    extracted.content.toLowerCase().startsWith("transcript:")
      ? `Transcript:\n${extracted.transcriptTimedText}`
      : extracted.content;

  io.stdout.write(extractCandidate);
  if (!extractCandidate.endsWith("\n")) {
    io.stdout.write("\n");
  }
  hooks.restoreProgressAfterStdout?.();
  const slideFooter = slides ? [`slides ${slides.slides.length}`] : [];
  hooks.writeViaFooter([...extractionUi.footerParts, ...slideFooter]);
  const report = flags.shouldComputeReport ? await hooks.buildReport() : null;
  if (flags.metricsEnabled && report) {
    const costUsd = await hooks.estimateCostUsd();
    hooks.clearProgressForStdout();
    writeFinishLine({
      stderr: io.stderr,
      env: io.envForRun,
      elapsedMs: Date.now() - flags.runStartedAtMs,
      label: finishLabel,
      model: finishModel,
      report,
      costUsd,
      detailed: flags.metricsDetailed,
      extraParts: buildFinishExtras({
        extracted,
        metricsDetailed: flags.metricsDetailed,
        transcriptionCostLabel,
      }),
      color: flags.verboseColor,
      pipeline: report?.pipeline ?? null,
    });
  }
}

export async function summarizeExtractedUrl({
  ctx,
  url,
  extracted,
  extractionUi,
  prompt,
  effectiveMarkdownMode,
  transcriptionCostLabel,
  onModelChosen,
  slides,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  extractionUi: UrlExtractionUi;
  prompt: string;
  effectiveMarkdownMode: "off" | "auto" | "llm" | "readability";
  transcriptionCostLabel: string | null;
  onModelChosen?: ((modelId: string) => void) | null;
  slides?: Awaited<
    ReturnType<typeof import("../../../slides/index.js").extractSlidesForSource>
  > | null;
}) {
  const { io, flags, model, cache: cacheState, hooks } = ctx;
  const engine = model.summaryEngine;
  const engineModelId = engine.modelId;

  const promptPayload: Prompt = { system: SUMMARY_SYSTEM_PROMPT, userText: prompt };
  const hasSlides = Boolean(slides && slides.slides.length > 0);
  const sanitizeKeyMoments = shouldSanitizeSummaryKeyMoments({ extracted, hasSlides });
  const timestampUpperBound = sanitizeKeyMoments
    ? resolveSummaryTimestampUpperBound(extracted)
    : null;

  const isYouTube = extracted.siteName === "YouTube" || isYouTubeUrl(url);
  const hasMedia =
    Boolean(extracted.video) ||
    (extracted.transcriptSource != null && extracted.transcriptSource !== "unavailable") ||
    (typeof extracted.mediaDurationSeconds === "number" && extracted.mediaDurationSeconds > 0) ||
    extracted.isVideoOnly === true;
  const canBypassShortContent =
    !flags.slides &&
    !hasMedia &&
    flags.streamMode !== "on" &&
    !isYouTube &&
    shouldBypassShortContentSummary({
      extracted,
      lengthArg: flags.lengthArg,
      forceSummary: flags.forceSummary,
      maxOutputTokensArg: flags.maxOutputTokensArg,
      json: flags.json,
      countTokens,
    });

  if (canBypassShortContent) {
    await outputSummaryFromExtractedContent({
      ctx,
      url,
      extracted,
      extractionUi,
      prompt,
      effectiveMarkdownMode,
      transcriptionCostLabel,
      slides,
      footerLabel: "short content",
      verboseMessage: "short content: skipping summary",
    });
    return;
  }

  // --- Cache lookup (single model) ---
  const cacheStore =
    cacheState.mode === "default" && !flags.summaryCacheBypass ? cacheState.store : null;
  const contentHash = cacheStore
    ? buildPromptContentHash({ prompt, fallbackContent: extracted.content })
    : null;
  const promptHash = cacheStore ? buildPromptHash(prompt) : null;
  const lengthKey = buildLengthKey(flags.lengthArg);
  const languageKey = buildLanguageKey(flags.outputLanguage);

  let summaryResult: Awaited<ReturnType<typeof engine.runSummary>> | null = null;
  let summaryFromCache = false;

  if (cacheStore && contentHash && promptHash) {
    const key = buildSummaryCacheKey({
      contentHash,
      promptHash,
      model: engineModelId,
      lengthKey,
      languageKey,
    });
    const cached = cacheStore.getText("summary", key);
    if (cached) {
      writeVerbose(io.stderr, flags.verbose, "cache hit summary", flags.verboseColor, io.envForRun);
      onModelChosen?.(engineModelId);
      summaryResult = {
        summary: cached,
        summaryAlreadyPrinted: false,
        modelMeta: { model: engineModelId },
        maxOutputTokensForCall: null,
      };
      summaryFromCache = true;
    } else {
      writeVerbose(
        io.stderr,
        flags.verbose,
        "cache miss summary",
        flags.verboseColor,
        io.envForRun,
      );
    }
  }
  ctx.hooks.onSummaryCached?.(summaryFromCache);

  // --- LLM call (single model, no fallback chain) ---
  if (!summaryResult) {
    summaryResult = await engine.runSummary({
      prompt: promptPayload,
      allowStreaming: flags.streamingEnabled && !sanitizeKeyMoments,
      onModelChosen: onModelChosen ?? null,
      streamHandler: null,
    });
  }

  const { summary, summaryAlreadyPrinted, modelMeta, maxOutputTokensForCall } = summaryResult;
  const normalizedSummaryBase =
    slides && slides.slides.length > 0 ? normalizeSummarySlideHeadings(summary) : summary;
  const normalizedSummary = sanitizeSummaryKeyMoments({
    markdown: normalizedSummaryBase,
    maxSeconds: timestampUpperBound,
  });

  // --- Cache write ---
  if (!summaryFromCache && cacheStore && contentHash && promptHash) {
    const cacheKey = buildSummaryCacheKey({
      contentHash,
      promptHash,
      model: engineModelId,
      lengthKey,
      languageKey,
    });
    cacheStore.setText("summary", cacheKey, normalizedSummary, cacheState.ttlMs);
    writeVerbose(io.stderr, flags.verbose, "cache write summary", flags.verboseColor, io.envForRun);
  }

  if (flags.json) {
    const finishReport = flags.shouldComputeReport ? await hooks.buildReport() : null;
    const payload = {
      input: {
        kind: "url" as const,
        url,
        timeoutMs: flags.timeoutMs,
        youtube: flags.youtubeMode,
        firecrawl: flags.firecrawlMode,
        format: flags.format,
        markdown: effectiveMarkdownMode,
        timestamps: flags.transcriptTimestamps,
        length:
          flags.lengthArg.kind === "preset"
            ? { kind: "preset" as const, preset: flags.lengthArg.preset }
            : { kind: "chars" as const, maxCharacters: flags.lengthArg.maxCharacters },
        maxOutputTokens: flags.maxOutputTokensArg,
        model: model.modelId,
        language: formatOutputLanguageForJson(flags.outputLanguage),
      },
      env: {
        hasApifyToken: Boolean(model.apifyToken),
        hasFirecrawlKey: model.firecrawlConfigured,
      },
      extracted,
      slides,
      prompt,
      llm: {
        model: modelMeta.model,
        maxCompletionTokens: maxOutputTokensForCall,
        strategy: "single" as const,
      },
      metrics: flags.metricsEnabled ? finishReport : null,
      pipeline: finishReport?.pipeline ?? null,
      summary: normalizedSummary,
    };
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (flags.metricsEnabled && finishReport) {
      const costUsd = await hooks.estimateCostUsd();
      writeFinishLine({
        stderr: io.stderr,
        env: io.envForRun,
        elapsedMs: Date.now() - flags.runStartedAtMs,
        elapsedLabel: summaryFromCache ? "Cached" : null,
        label: extractionUi.finishSourceLabel,
        model: modelMeta.model,
        report: finishReport,
        costUsd,
        detailed: flags.metricsDetailed,
        extraParts: buildFinishExtras({
          extracted,
          metricsDetailed: flags.metricsDetailed,
          transcriptionCostLabel,
        }),
        color: flags.verboseColor,
        pipeline: finishReport?.pipeline ?? null,
      });
    }
    return;
  }

  if (!summaryAlreadyPrinted) {
    hooks.clearProgressForStdout();
    io.stdout.write(normalizedSummary.replace(/^\n+/, ""));
    if (!normalizedSummary.endsWith("\n")) {
      io.stdout.write("\n");
    }
    hooks.restoreProgressAfterStdout?.();
  }

  const report = flags.shouldComputeReport ? await hooks.buildReport() : null;
  if (flags.metricsEnabled && report) {
    const costUsd = await hooks.estimateCostUsd();
    writeFinishLine({
      stderr: io.stderr,
      env: io.envForRun,
      elapsedMs: Date.now() - flags.runStartedAtMs,
      elapsedLabel: summaryFromCache ? "Cached" : null,
      label: extractionUi.finishSourceLabel,
      model: modelMeta.model,
      report,
      costUsd,
      detailed: flags.metricsDetailed,
      extraParts: buildFinishExtras({
        extracted,
        metricsDetailed: flags.metricsDetailed,
        transcriptionCostLabel,
      }),
      color: flags.verboseColor,
      pipeline: report?.pipeline ?? null,
    });
  }
}
