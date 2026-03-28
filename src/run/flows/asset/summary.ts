import { countTokens } from "gpt-tokenizer";
import {
  buildLanguageKey,
  buildLengthKey,
  buildPromptContentHash,
  buildPromptHash,
  buildSummaryCacheKey,
  type CacheState,
} from "../../../cache.js";
import type { MediaCache } from "../../../content/index.js";
import type { LlmCall, RunMetricsReport } from "../../../costs.js";
import type { OutputLanguage } from "../../../language.js";
import { formatOutputLanguageForJson } from "../../../language.js";
import type { Prompt } from "../../../llm/prompt.js";
import type { ExecFileFn } from "../../../markitdown.js";
import { SUMMARY_LENGTH_TARGET_CHARACTERS, SUMMARY_SYSTEM_PROMPT } from "../../../prompts/index.js";
import type { SummaryLength } from "../../../shared/contracts.js";
import { type AssetAttachment, isUnsupportedAttachmentError } from "../../attachments.js";
import { writeFinishLine } from "../../finish-line.js";
import { resolveTargetCharacters } from "../../format.js";
import { writeVerbose } from "../../logging.js";
import type { createSummaryEngine } from "../../summary-engine.js";
import { prepareAssetPrompt } from "./preprocess.js";

function shouldBypassShortContentSummary({
  ctx,
  textContent,
}: {
  ctx: Pick<AssetSummaryContext, "forceSummary" | "lengthArg" | "maxOutputTokensArg" | "json">;
  textContent: { content: string } | null;
}): boolean {
  if (ctx.forceSummary) return false;
  if (!textContent?.content) return false;
  const targetCharacters = resolveTargetCharacters(ctx.lengthArg, SUMMARY_LENGTH_TARGET_CHARACTERS);
  if (!Number.isFinite(targetCharacters) || targetCharacters <= 0) return false;
  if (textContent.content.length > targetCharacters) return false;
  if (!ctx.json && typeof ctx.maxOutputTokensArg === "number") {
    const tokenCount = countTokens(textContent.content);
    if (tokenCount > ctx.maxOutputTokensArg) return false;
  }
  return true;
}

async function outputBypassedAssetSummary({
  ctx,
  args,
  promptText,
  summaryText,
  assetFooterParts,
  footerLabel,
}: {
  ctx: AssetSummaryContext;
  args: SummarizeAssetArgs;
  promptText: string;
  summaryText: string;
  assetFooterParts: string[];
  footerLabel: string;
}) {
  const summary = summaryText.trimEnd();
  const extracted = {
    kind: "asset" as const,
    source: args.sourceLabel,
    mediaType: args.attachment.mediaType,
    filename: args.attachment.filename,
  };

  if (ctx.json) {
    ctx.clearProgressForStdout();
    const finishReport = ctx.shouldComputeReport ? await ctx.buildReport() : null;
    const input =
      args.sourceKind === "file"
        ? {
            kind: "file",
            filePath: args.sourceLabel,
            timeoutMs: ctx.timeoutMs,
            length:
              ctx.lengthArg.kind === "preset"
                ? { kind: "preset", preset: ctx.lengthArg.preset }
                : { kind: "chars", maxCharacters: ctx.lengthArg.maxCharacters },
            maxOutputTokens: ctx.maxOutputTokensArg,
            model: ctx.requestedModelLabel,
            language: formatOutputLanguageForJson(ctx.outputLanguage),
          }
        : {
            kind: "asset-url",
            url: args.sourceLabel,
            timeoutMs: ctx.timeoutMs,
            length:
              ctx.lengthArg.kind === "preset"
                ? { kind: "preset", preset: ctx.lengthArg.preset }
                : { kind: "chars", maxCharacters: ctx.lengthArg.maxCharacters },
            maxOutputTokens: ctx.maxOutputTokensArg,
            model: ctx.requestedModelLabel,
            language: formatOutputLanguageForJson(ctx.outputLanguage),
          };
    const payload = {
      input,
      env: {
        hasApifyToken: Boolean(ctx.apiStatus.apifyToken),
        hasFirecrawlKey: ctx.apiStatus.firecrawlConfigured,
      },
      extracted,
      prompt: promptText,
      llm: null,
      metrics: ctx.metricsEnabled ? finishReport : null,
      pipeline: null,
      summary,
    };
    ctx.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    ctx.restoreProgressAfterStdout?.();
    if (ctx.metricsEnabled && finishReport) {
      const costUsd = await ctx.estimateCostUsd();
      writeFinishLine({
        stderr: ctx.stderr,
        env: ctx.envForRun,
        elapsedMs: Date.now() - ctx.runStartedAtMs,
        elapsedLabel: null,
        model: null,
        report: finishReport,
        costUsd,
        detailed: ctx.metricsDetailed,
        extraParts: null,
        color: ctx.verboseColor,
        pipeline: null,
      });
    }
    return;
  }

  ctx.clearProgressForStdout();
  ctx.stdout.write(summary.replace(/^\n+/, ""));
  if (!summary.endsWith("\n")) {
    ctx.stdout.write("\n");
  }
  ctx.restoreProgressAfterStdout?.();
  if (assetFooterParts.length > 0) {
    ctx.writeViaFooter([...assetFooterParts, footerLabel]);
  }

  const report = ctx.shouldComputeReport ? await ctx.buildReport() : null;
  if (ctx.metricsEnabled && report) {
    const costUsd = await ctx.estimateCostUsd();
    writeFinishLine({
      stderr: ctx.stderr,
      env: ctx.envForRun,
      elapsedMs: Date.now() - ctx.runStartedAtMs,
      elapsedLabel: null,
      model: null,
      report,
      costUsd,
      detailed: ctx.metricsDetailed,
      extraParts: null,
      color: ctx.verboseColor,
      pipeline: null,
    });
  }
}

export type AssetSummaryContext = {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  execFileImpl: ExecFileFn;
  timeoutMs: number;
  preprocessMode: "off" | "auto" | "always";
  format: "text" | "markdown";
  extractMode: boolean;
  lengthArg: { kind: "preset"; preset: SummaryLength } | { kind: "chars"; maxCharacters: number };
  forceSummary: boolean;
  outputLanguage: OutputLanguage;
  videoMode: "auto" | "transcript" | "understand";
  promptOverride?: string | null;
  lengthInstruction?: string | null;
  languageInstruction?: string | null;
  requestedModelLabel: string;
  maxOutputTokensArg: number | null;
  json: boolean;
  metricsEnabled: boolean;
  metricsDetailed: boolean;
  shouldComputeReport: boolean;
  runStartedAtMs: number;
  verbose: boolean;
  verboseColor: boolean;
  streamingEnabled: boolean;
  plain: boolean;
  summaryEngine: ReturnType<typeof createSummaryEngine>;
  writeViaFooter: (parts: string[]) => void;
  clearProgressForStdout: () => void;
  restoreProgressAfterStdout?: (() => void) | null;
  buildReport: () => Promise<RunMetricsReport>;
  estimateCostUsd: () => Promise<number | null>;
  llmCalls: LlmCall[];
  cache: CacheState;
  summaryCacheBypass: boolean;
  mediaCache: MediaCache | null;
  apiStatus: {
    apifyToken: string | null;
    firecrawlConfigured: boolean;
  };
};

export type SummarizeAssetArgs = {
  sourceKind: "file" | "asset-url";
  sourceLabel: string;
  attachment: AssetAttachment;
  onModelChosen?: ((modelId: string) => void) | null;
};

export async function summarizeAsset(ctx: AssetSummaryContext, args: SummarizeAssetArgs) {
  const engine = ctx.summaryEngine;
  const engineModelId = engine.modelId;

  const { promptText, attachments, assetFooterParts, textContent } = await prepareAssetPrompt({
    ctx: {
      env: ctx.env,
      envForRun: ctx.envForRun,
      execFileImpl: ctx.execFileImpl,
      timeoutMs: ctx.timeoutMs,
      preprocessMode: ctx.preprocessMode,
      format: ctx.format,
      lengthArg: ctx.lengthArg,
      outputLanguage: ctx.outputLanguage,
      promptOverride: ctx.promptOverride ?? null,
      lengthInstruction: ctx.lengthInstruction ?? null,
      languageInstruction: ctx.languageInstruction ?? null,
    },
    attachment: args.attachment,
  });
  const prompt: Prompt = {
    system: SUMMARY_SYSTEM_PROMPT,
    userText: promptText,
    ...(attachments.length > 0 ? { attachments } : {}),
  };

  if (shouldBypassShortContentSummary({ ctx, textContent })) {
    await outputBypassedAssetSummary({
      ctx,
      args,
      promptText,
      summaryText: textContent?.content ?? "",
      assetFooterParts,
      footerLabel: "short content",
    });
    return;
  }

  if (
    !ctx.forceSummary &&
    !ctx.json &&
    typeof ctx.maxOutputTokensArg === "number" &&
    textContent &&
    countTokens(textContent.content) <= ctx.maxOutputTokensArg
  ) {
    ctx.clearProgressForStdout();
    ctx.stdout.write(`${textContent.content.trim()}\n`);
    ctx.restoreProgressAfterStdout?.();
    if (assetFooterParts.length > 0) {
      ctx.writeViaFooter([...assetFooterParts, "no model"]);
    }
    return;
  }

  // --- Cache lookup (single model) ---
  const cacheStore =
    ctx.cache.mode === "default" && !ctx.summaryCacheBypass ? ctx.cache.store : null;
  const contentHash = cacheStore ? buildPromptContentHash({ prompt: promptText }) : null;
  const promptHash = cacheStore ? buildPromptHash(promptText) : null;
  const lengthKey = buildLengthKey(ctx.lengthArg);
  const languageKey = buildLanguageKey(ctx.outputLanguage);

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
      writeVerbose(ctx.stderr, ctx.verbose, "cache hit summary", ctx.verboseColor, ctx.envForRun);
      args.onModelChosen?.(engineModelId);
      summaryResult = {
        summary: cached,
        summaryAlreadyPrinted: false,
        modelMeta: { model: engineModelId },
        maxOutputTokensForCall: null,
      };
      summaryFromCache = true;
    } else {
      writeVerbose(ctx.stderr, ctx.verbose, "cache miss summary", ctx.verboseColor, ctx.envForRun);
    }
  }

  // --- LLM call (single model, no fallback chain) ---
  if (!summaryResult) {
    try {
      summaryResult = await engine.runSummary({
        prompt,
        allowStreaming: ctx.streamingEnabled,
        onModelChosen: args.onModelChosen ?? null,
      });
    } catch (error) {
      if (isUnsupportedAttachmentError(error)) {
        throw new Error(
          `Model ${engineModelId} does not support attaching files of type ${args.attachment.mediaType}. Try a different --model.`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  const { summary, summaryAlreadyPrinted, modelMeta, maxOutputTokensForCall } = summaryResult;

  // --- Cache write ---
  if (!summaryFromCache && cacheStore && contentHash && promptHash) {
    const cacheKey = buildSummaryCacheKey({
      contentHash,
      promptHash,
      model: engineModelId,
      lengthKey,
      languageKey,
    });
    cacheStore.setText("summary", cacheKey, summary, ctx.cache.ttlMs);
    writeVerbose(ctx.stderr, ctx.verbose, "cache write summary", ctx.verboseColor, ctx.envForRun);
  }

  const extracted = {
    kind: "asset" as const,
    source: args.sourceLabel,
    mediaType: args.attachment.mediaType,
    filename: args.attachment.filename,
  };

  if (ctx.json) {
    ctx.clearProgressForStdout();
    const finishReport = ctx.shouldComputeReport ? await ctx.buildReport() : null;
    const input: {
      kind: "file" | "asset-url";
      filePath?: string;
      url?: string;
      timeoutMs: number;
      length: { kind: "preset"; preset: string } | { kind: "chars"; maxCharacters: number };
      maxOutputTokens: number | null;
      model: string;
      language: ReturnType<typeof formatOutputLanguageForJson>;
    } =
      args.sourceKind === "file"
        ? {
            kind: "file",
            filePath: args.sourceLabel,
            timeoutMs: ctx.timeoutMs,
            length:
              ctx.lengthArg.kind === "preset"
                ? { kind: "preset", preset: ctx.lengthArg.preset }
                : { kind: "chars", maxCharacters: ctx.lengthArg.maxCharacters },
            maxOutputTokens: ctx.maxOutputTokensArg,
            model: ctx.requestedModelLabel,
            language: formatOutputLanguageForJson(ctx.outputLanguage),
          }
        : {
            kind: "asset-url",
            url: args.sourceLabel,
            timeoutMs: ctx.timeoutMs,
            length:
              ctx.lengthArg.kind === "preset"
                ? { kind: "preset", preset: ctx.lengthArg.preset }
                : { kind: "chars", maxCharacters: ctx.lengthArg.maxCharacters },
            maxOutputTokens: ctx.maxOutputTokensArg,
            model: ctx.requestedModelLabel,
            language: formatOutputLanguageForJson(ctx.outputLanguage),
          };
    const payload = {
      input,
      env: {
        hasApifyToken: Boolean(ctx.apiStatus.apifyToken),
        hasFirecrawlKey: ctx.apiStatus.firecrawlConfigured,
      },
      extracted,
      prompt: promptText,
      llm: {
        model: modelMeta.model,
        maxCompletionTokens: maxOutputTokensForCall,
        strategy: "single" as const,
      },
      metrics: ctx.metricsEnabled ? finishReport : null,
      pipeline: null,
      summary,
    };
    ctx.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    ctx.restoreProgressAfterStdout?.();
    if (ctx.metricsEnabled && finishReport) {
      const costUsd = await ctx.estimateCostUsd();
      writeFinishLine({
        stderr: ctx.stderr,
        env: ctx.envForRun,
        elapsedMs: Date.now() - ctx.runStartedAtMs,
        elapsedLabel: summaryFromCache ? "Cached" : null,
        model: modelMeta.model,
        report: finishReport,
        costUsd,
        detailed: ctx.metricsDetailed,
        extraParts: null,
        color: ctx.verboseColor,
        pipeline: null,
      });
    }
    return;
  }

  if (!summaryAlreadyPrinted) {
    ctx.clearProgressForStdout();
    ctx.stdout.write(summary.replace(/^\n+/, ""));
    if (!summary.endsWith("\n")) {
      ctx.stdout.write("\n");
    }
    ctx.restoreProgressAfterStdout?.();
  }

  ctx.writeViaFooter([...assetFooterParts, `model ${modelMeta.model}`]);

  const report = ctx.shouldComputeReport ? await ctx.buildReport() : null;
  if (ctx.metricsEnabled && report) {
    const costUsd = await ctx.estimateCostUsd();
    writeFinishLine({
      stderr: ctx.stderr,
      env: ctx.envForRun,
      elapsedMs: Date.now() - ctx.runStartedAtMs,
      elapsedLabel: summaryFromCache ? "Cached" : null,
      model: modelMeta.model,
      report,
      costUsd,
      detailed: ctx.metricsDetailed,
      extraParts: null,
      color: ctx.verboseColor,
      pipeline: null,
    });
  }
}
