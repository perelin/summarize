import { countTokens } from "gpt-tokenizer";
import {
  buildLanguageKey,
  buildLengthKey,
  buildPromptContentHash,
  buildPromptHash,
  buildSummaryCacheKey,
} from "../../../cache.js";
import type { ExtractedLinkContent } from "../../../content/index.js";
import { isTwitterStatusUrl, isYouTubeUrl } from "../../../core/content/url.js";
import { formatOutputLanguageForJson } from "../../../language.js";
import type { Prompt } from "../../../llm/prompt.js";
import { buildAutoModelAttempts } from "../../../model-auto.js";
import { SUMMARY_SYSTEM_PROMPT } from "../../../prompts/index.js";
import { buildExtractFinishLabel, writeFinishLine } from "../../finish-line.js";
import { writeVerbose } from "../../logging.js";
import { runModelAttempts } from "../../model-attempts.js";
import { buildOpenRouterNoAllowedProvidersMessage } from "../../openrouter.js";
import type { ModelAttempt } from "../../types.js";
import type { UrlExtractionUi } from "./extract.js";
import { normalizeSummarySlideHeadings } from "./slides-text.js";
import {
  buildFinishExtras,
  buildModelMetaFromAttempt,
  pickModelForFinishLine,
} from "./summary-finish.js";
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
        model: model.requestedModelLabel,
        language: formatOutputLanguageForJson(flags.outputLanguage),
      },
      env: {
        hasXaiKey: Boolean(model.apiStatus.xaiApiKey),
        hasOpenAIKey: Boolean(model.apiStatus.apiKey),
        hasOpenRouterKey: Boolean(model.apiStatus.openrouterApiKey),
        hasApifyToken: Boolean(model.apiStatus.apifyToken),
        hasFirecrawlKey: model.apiStatus.firecrawlConfigured,
        hasGoogleKey: model.apiStatus.googleConfigured,
        hasAnthropicKey: model.apiStatus.anthropicConfigured,
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
        model: model.requestedModelLabel,
        language: formatOutputLanguageForJson(flags.outputLanguage),
      },
      env: {
        hasXaiKey: Boolean(model.apiStatus.xaiApiKey),
        hasOpenAIKey: Boolean(model.apiStatus.apiKey),
        hasOpenRouterKey: Boolean(model.apiStatus.openrouterApiKey),
        hasApifyToken: Boolean(model.apiStatus.apifyToken),
        hasFirecrawlKey: model.apiStatus.firecrawlConfigured,
        hasGoogleKey: model.apiStatus.googleConfigured,
        hasAnthropicKey: model.apiStatus.anthropicConfigured,
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

  const promptPayload: Prompt = { system: SUMMARY_SYSTEM_PROMPT, userText: prompt };
  const promptTokens = countTokens(promptPayload.userText);
  const kindForAuto =
    extracted.siteName === "YouTube" ? ("youtube" as const) : ("website" as const);
  const hasSlides = Boolean(slides && slides.slides.length > 0);
  const sanitizeKeyMoments = shouldSanitizeSummaryKeyMoments({ extracted, hasSlides });
  const timestampUpperBound = sanitizeKeyMoments
    ? resolveSummaryTimestampUpperBound(extracted)
    : null;

  const attempts: ModelAttempt[] = await (async () => {
    if (model.isFallbackModel) {
      const catalog = await model.getLiteLlmCatalog();
      const list = buildAutoModelAttempts({
        kind: kindForAuto,
        promptTokens,
        desiredOutputTokens: model.desiredOutputTokens,
        requiresVideoUnderstanding: false,
        env: model.envForAuto,
        config: model.configForModelSelection,
        catalog,
        openrouterProvidersFromEnv: null,
        isImplicitAutoSelection: model.isImplicitAutoSelection,
      });
      if (flags.verbose) {
        for (const attempt of list.slice(0, 8)) {
          writeVerbose(
            io.stderr,
            flags.verbose,
            `auto candidate ${attempt.debug}`,
            flags.verboseColor,
            io.envForRun,
          );
        }
      }
      return list.map((attempt) =>
        model.summaryEngine.applyOpenAiGatewayOverrides(attempt as ModelAttempt),
      );
    }
    /* v8 ignore next */
    if (!model.fixedModelSpec) {
      throw new Error("Internal error: missing fixed model spec");
    }
    const openaiOverrides =
      model.fixedModelSpec.requiredEnv === "Z_AI_API_KEY"
        ? {
            openaiApiKeyOverride: model.apiStatus.zaiApiKey,
            openaiBaseUrlOverride: model.apiStatus.zaiBaseUrl,
            forceChatCompletions: true,
          }
        : model.fixedModelSpec.requiredEnv === "NVIDIA_API_KEY"
          ? {
              openaiApiKeyOverride: model.apiStatus.nvidiaApiKey,
              openaiBaseUrlOverride: model.apiStatus.nvidiaBaseUrl,
              forceChatCompletions: true,
            }
          : {};
    return [
      {
        transport: model.fixedModelSpec.transport === "openrouter" ? "openrouter" : "native",
        userModelId: model.fixedModelSpec.userModelId,
        llmModelId: model.fixedModelSpec.llmModelId,
        openrouterProviders: model.fixedModelSpec.openrouterProviders,
        forceOpenRouter: model.fixedModelSpec.forceOpenRouter,
        requiredEnv: model.fixedModelSpec.requiredEnv,
        ...openaiOverrides,
      },
    ];
  })();

  const cacheStore =
    cacheState.mode === "default" && !flags.summaryCacheBypass ? cacheState.store : null;
  const contentHash = cacheStore
    ? buildPromptContentHash({ prompt, fallbackContent: extracted.content })
    : null;
  const promptHash = cacheStore ? buildPromptHash(prompt) : null;
  const lengthKey = buildLengthKey(flags.lengthArg);
  const languageKey = buildLanguageKey(flags.outputLanguage);
  const autoSelectionCacheModel = model.isFallbackModel
    ? `selection:${model.requestedModelInput.toLowerCase()}`
    : null;

  let summaryResult: Awaited<ReturnType<typeof model.summaryEngine.runSummaryAttempt>> | null =
    null;
  let usedAttempt: ModelAttempt | null = null;
  let summaryFromCache = false;
  let cacheChecked = false;

  const isTweet = extracted.siteName?.toLowerCase() === "x" || isTwitterStatusUrl(extracted.url);
  const isYouTube = extracted.siteName === "YouTube" || isYouTubeUrl(url);
  const hasMedia =
    Boolean(extracted.video) ||
    (extracted.transcriptSource != null && extracted.transcriptSource !== "unavailable") ||
    (typeof extracted.mediaDurationSeconds === "number" && extracted.mediaDurationSeconds > 0) ||
    extracted.isVideoOnly === true;
  const autoBypass = ctx.model.isFallbackModel && !ctx.model.isNamedModelSelection;
  const canBypassShortContent =
    (autoBypass || isTweet) &&
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

  if (cacheStore && contentHash && promptHash) {
    cacheChecked = true;
    if (autoSelectionCacheModel) {
      const key = buildSummaryCacheKey({
        contentHash,
        promptHash,
        model: autoSelectionCacheModel,
        lengthKey,
        languageKey,
      });
      const cached = cacheStore.getJson<{ summary?: unknown; model?: unknown }>("summary", key);
      const cachedSummary =
        cached && typeof cached.summary === "string" ? cached.summary.trim() : null;
      const cachedModelId = cached && typeof cached.model === "string" ? cached.model.trim() : null;
      if (cachedSummary) {
        const cachedAttempt = cachedModelId
          ? (attempts.find((attempt) => attempt.userModelId === cachedModelId) ?? null)
          : null;
        const fallbackAttempt =
          attempts.find((attempt) => model.summaryEngine.envHasKeyFor(attempt.requiredEnv)) ??
          attempts[0] ??
          null;
        const matchedAttempt =
          cachedAttempt && model.summaryEngine.envHasKeyFor(cachedAttempt.requiredEnv)
            ? cachedAttempt
            : fallbackAttempt;
        if (matchedAttempt) {
          writeVerbose(
            io.stderr,
            flags.verbose,
            "cache hit summary (auto selection)",
            flags.verboseColor,
            io.envForRun,
          );
          onModelChosen?.(cachedModelId || matchedAttempt.userModelId);
          summaryResult = {
            summary: cachedSummary,
            summaryAlreadyPrinted: false,
            modelMeta: buildModelMetaFromAttempt(matchedAttempt),
            maxOutputTokensForCall: null,
          };
          usedAttempt = matchedAttempt;
          summaryFromCache = true;
        }
      }
    }
    if (!summaryFromCache) {
      for (const attempt of attempts) {
        if (!model.summaryEngine.envHasKeyFor(attempt.requiredEnv)) continue;
        const key = buildSummaryCacheKey({
          contentHash,
          promptHash,
          model: attempt.userModelId,
          lengthKey,
          languageKey,
        });
        const cached = cacheStore.getText("summary", key);
        if (!cached) continue;
        writeVerbose(
          io.stderr,
          flags.verbose,
          "cache hit summary",
          flags.verboseColor,
          io.envForRun,
        );
        onModelChosen?.(attempt.userModelId);
        summaryResult = {
          summary: cached,
          summaryAlreadyPrinted: false,
          modelMeta: buildModelMetaFromAttempt(attempt),
          maxOutputTokensForCall: null,
        };
        usedAttempt = attempt;
        summaryFromCache = true;
        break;
      }
    }
  }
  if (cacheChecked && !summaryFromCache) {
    writeVerbose(io.stderr, flags.verbose, "cache miss summary", flags.verboseColor, io.envForRun);
  }
  ctx.hooks.onSummaryCached?.(summaryFromCache);

  let lastError: unknown = null;
  let missingRequiredEnvs = new Set<ModelAttempt["requiredEnv"]>();
  let sawOpenRouterNoAllowedProviders = false;

  if (!summaryResult || !usedAttempt) {
    const attemptOutcome = await runModelAttempts({
      attempts,
      isFallbackModel: model.isFallbackModel,
      isNamedModelSelection: model.isNamedModelSelection,
      envHasKeyFor: model.summaryEngine.envHasKeyFor,
      formatMissingModelError: model.summaryEngine.formatMissingModelError,
      onAutoSkip: (attempt) => {
        writeVerbose(
          io.stderr,
          flags.verbose,
          `auto skip ${attempt.userModelId}: missing ${attempt.requiredEnv}`,
          flags.verboseColor,
          io.envForRun,
        );
      },
      onAutoFailure: (attempt, error) => {
        writeVerbose(
          io.stderr,
          flags.verbose,
          `auto failed ${attempt.userModelId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          flags.verboseColor,
          io.envForRun,
        );
      },
      onFixedModelError: (_attempt, error) => {
        throw error;
      },
      runAttempt: (attempt) =>
        model.summaryEngine.runSummaryAttempt({
          attempt,
          prompt: promptPayload,
          allowStreaming: flags.streamingEnabled && !sanitizeKeyMoments,
          onModelChosen: onModelChosen ?? null,
          streamHandler: null,
        }),
    });
    summaryResult = attemptOutcome.result;
    usedAttempt = attemptOutcome.usedAttempt;
    lastError = attemptOutcome.lastError;
    missingRequiredEnvs = attemptOutcome.missingRequiredEnvs;
    sawOpenRouterNoAllowedProviders = attemptOutcome.sawOpenRouterNoAllowedProviders;
  }

  if (!summaryResult || !usedAttempt) {
    // Auto mode: surface raw extracted content when no model can run.
    const withFreeTip = (message: string) => message;

    if (model.isNamedModelSelection) {
      if (lastError === null && missingRequiredEnvs.size > 0) {
        throw new Error(
          withFreeTip(
            `Missing ${Array.from(missingRequiredEnvs).sort().join(", ")} for --model ${model.requestedModelInput}.`,
          ),
        );
      }
      if (lastError instanceof Error) {
        if (sawOpenRouterNoAllowedProviders) {
          const message = await buildOpenRouterNoAllowedProvidersMessage({
            attempts,
            fetchImpl: io.fetch,
            timeoutMs: flags.timeoutMs,
          });
          throw new Error(withFreeTip(message), { cause: lastError });
        }
        throw new Error(withFreeTip(lastError.message), { cause: lastError });
      }
      throw new Error(withFreeTip(`No model available for --model ${model.requestedModelInput}`));
    }
    await outputSummaryFromExtractedContent({
      ctx,
      url,
      extracted,
      extractionUi,
      prompt,
      effectiveMarkdownMode,
      transcriptionCostLabel,
      slides,
      footerLabel: "no model",
      verboseMessage:
        lastError instanceof Error ? `auto failed all models: ${lastError.message}` : null,
    });
    return;
  }

  const { summary, summaryAlreadyPrinted, modelMeta, maxOutputTokensForCall } = summaryResult;
  const normalizedSummaryBase =
    slides && slides.slides.length > 0 ? normalizeSummarySlideHeadings(summary) : summary;
  const normalizedSummary = sanitizeSummaryKeyMoments({
    markdown: normalizedSummaryBase,
    maxSeconds: timestampUpperBound,
  });

  if (!summaryFromCache && cacheStore && contentHash && promptHash) {
    const perModelKey = buildSummaryCacheKey({
      contentHash,
      promptHash,
      model: usedAttempt.userModelId,
      lengthKey,
      languageKey,
    });
    cacheStore.setText("summary", perModelKey, normalizedSummary, cacheState.ttlMs);
    writeVerbose(io.stderr, flags.verbose, "cache write summary", flags.verboseColor, io.envForRun);
    if (autoSelectionCacheModel) {
      const selectionKey = buildSummaryCacheKey({
        contentHash,
        promptHash,
        model: autoSelectionCacheModel,
        lengthKey,
        languageKey,
      });
      cacheStore.setJson(
        "summary",
        selectionKey,
        { summary: normalizedSummary, model: usedAttempt.userModelId },
        cacheState.ttlMs,
      );
      writeVerbose(
        io.stderr,
        flags.verbose,
        "cache write summary (auto selection)",
        flags.verboseColor,
        io.envForRun,
      );
    }
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
        model: model.requestedModelLabel,
        language: formatOutputLanguageForJson(flags.outputLanguage),
      },
      env: {
        hasXaiKey: Boolean(model.apiStatus.xaiApiKey),
        hasOpenAIKey: Boolean(model.apiStatus.apiKey),
        hasOpenRouterKey: Boolean(model.apiStatus.openrouterApiKey),
        hasApifyToken: Boolean(model.apiStatus.apifyToken),
        hasFirecrawlKey: model.apiStatus.firecrawlConfigured,
        hasGoogleKey: model.apiStatus.googleConfigured,
        hasAnthropicKey: model.apiStatus.anthropicConfigured,
      },
      extracted,
      slides,
      prompt,
      llm: {
        provider: modelMeta.provider,
        model: usedAttempt.userModelId,
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
        model: usedAttempt.userModelId,
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
      model: modelMeta.canonical,
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
