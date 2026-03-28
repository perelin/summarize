import { buildExtractCacheKey } from "../../../cache.js";
import { loadRemoteAsset } from "../../../content/asset.js";
import {
  createLinkPreviewClient,
  type ExtractedLinkContent,
  type FetchLinkContentOptions,
} from "../../../content/index.js";
import { NEGATIVE_TTL_MS } from "../../../core/content/index.js";
import * as urlUtils from "../../../core/content/url.js";
import { createFirecrawlScraper } from "../../../firecrawl.js";
import { assertAssetMediaTypeSupported } from "../../attachments.js";
import { readTweetWithPreferredClient } from "../../bird.js";
import { UVX_TIP } from "../../constants.js";
import { resolveTwitterCookies } from "../../cookies/twitter.js";
import { hasBirdCli, hasUvxCli, hasXurlCli } from "../../env.js";
import {
  estimateWhisperTranscriptionCostUsd,
  formatOptionalNumber,
  formatOptionalString,
  formatUSD,
} from "../../format.js";
import { writeVerbose } from "../../logging.js";
import type { PipelineInfo } from "../../run-metrics.js";
import {
  deriveExtractionUi,
  fetchLinkContentWithBirdTip,
  logExtractionDiagnostics,
} from "./extract.js";
import { createMarkdownConverters } from "./markdown.js";
import { buildUrlPrompt, outputExtractedUrl, summarizeExtractedUrl } from "./summary.js";
import type { UrlFlowContext } from "./types.js";

export async function runUrlFlow({
  ctx,
  url,
  isYoutubeUrl,
}: {
  ctx: UrlFlowContext;
  url: string;
  isYoutubeUrl: boolean;
}): Promise<void> {
  if (!url) {
    throw new Error("Only HTTP and HTTPS URLs can be summarized");
  }

  const { io, flags, model, cache: cacheState, hooks } = ctx;

  const markdown = createMarkdownConverters(ctx, { isYoutubeUrl });
  if (flags.firecrawlMode === "always" && !model.firecrawlConfigured) {
    throw new Error("--firecrawl always requires FIRECRAWL_API_KEY");
  }

  writeVerbose(
    io.stderr,
    flags.verbose,
    `config url=${url} timeoutMs=${flags.timeoutMs} youtube=${flags.youtubeMode} firecrawl=${flags.firecrawlMode} length=${
      flags.lengthArg.kind === "preset"
        ? flags.lengthArg.preset
        : `${flags.lengthArg.maxCharacters} chars`
    } maxOutputTokens=${formatOptionalNumber(flags.maxOutputTokensArg)} retries=${flags.retries} json=${flags.json} extract=${flags.extractMode} format=${flags.format} preprocess=${flags.preprocessMode} markdownMode=${flags.markdownMode} model=${model.modelId} videoMode=${flags.videoMode} timestamps=${flags.transcriptTimestamps ? "on" : "off"} stream=${flags.streamingEnabled ? "on" : "off"} plain=${flags.plain}`,
    flags.verboseColor,
    io.envForRun,
  );
  writeVerbose(
    io.stderr,
    flags.verbose,
    `configFile path=${formatOptionalString(flags.configPath)} model=${formatOptionalString(
      flags.configModelLabel,
    )}`,
    flags.verboseColor,
    io.envForRun,
  );
  writeVerbose(
    io.stderr,
    flags.verbose,
    `env litellmBaseUrl=${model.connection.baseUrl} apifyToken=${Boolean(model.apifyToken)} firecrawlKey=${model.firecrawlConfigured}`,
    flags.verboseColor,
    io.envForRun,
  );
  writeVerbose(
    io.stderr,
    flags.verbose,
    `markdown htmlRequested=${markdown.markdownRequested} transcriptRequested=${markdown.transcriptMarkdownRequested}`,
    flags.verboseColor,
    io.envForRun,
  );

  const firecrawlApiKey = model.firecrawlApiKey;
  const scrapeWithFirecrawl =
    model.firecrawlConfigured && flags.firecrawlMode !== "off" && firecrawlApiKey
      ? createFirecrawlScraper({
          apiKey: firecrawlApiKey,
          fetchImpl: io.fetch,
        })
      : null;

  const readTweetWithBirdClient =
    hasXurlCli(io.env) || hasBirdCli(io.env)
      ? ({ url, timeoutMs }: { url: string; timeoutMs: number }) =>
          readTweetWithPreferredClient({ url, timeoutMs, env: io.env })
      : null;

  writeVerbose(io.stderr, flags.verbose, "extract start", flags.verboseColor, io.envForRun);

  const cacheStore = cacheState.mode === "default" ? cacheState.store : null;
  const transcriptCache = cacheStore ? cacheStore.transcriptCache : null;

  const client = createLinkPreviewClient({
    env: io.envForRun,
    apifyApiToken: model.apifyToken,
    ytDlpPath: model.ytDlpPath,
    transcription: {
      env: io.envForRun,
    },
    scrapeWithFirecrawl,
    convertHtmlToMarkdown: markdown.convertHtmlToMarkdown,
    readTweetWithBird: readTweetWithBirdClient,
    resolveTwitterCookies: async (_args) => {
      const res = await resolveTwitterCookies({ env: io.env });
      return {
        cookiesFromBrowser: res.cookies.cookiesFromBrowser,
        source: res.cookies.source,
        warnings: res.warnings,
      };
    },
    fetch: io.fetch,
    transcriptCache,
    mediaCache: ctx.mediaCache ?? null,
    onProgress: hooks.onLinkPreviewProgress
      ? (event) => {
          hooks.onLinkPreviewProgress?.(event);
        }
      : null,
  });

  hooks.setClearProgressBeforeStdout(null);
  try {
    const buildFetchOptions = (): FetchLinkContentOptions => ({
      timeoutMs: flags.timeoutMs,
      maxCharacters:
        typeof flags.maxExtractCharacters === "number" && flags.maxExtractCharacters > 0
          ? flags.maxExtractCharacters
          : undefined,
      youtubeTranscript: flags.youtubeMode,
      mediaTranscript: flags.videoMode === "transcript" ? "prefer" : "auto",
      transcriptTimestamps: flags.transcriptTimestamps,
      firecrawl: flags.firecrawlMode,
      format: markdown.markdownRequested ? "markdown" : "text",
      markdownMode: markdown.markdownRequested ? markdown.effectiveMarkdownMode : undefined,
      cacheMode: cacheState.mode,
    });

    const fetchWithCache = async (
      targetUrl: string,
      {
        bypassExtractCache = false,
      }: {
        bypassExtractCache?: boolean;
      } = {},
    ): Promise<ExtractedLinkContent> => {
      const options = buildFetchOptions();
      const cacheKey =
        cacheStore && cacheState.mode === "default"
          ? buildExtractCacheKey({
              url: targetUrl,
              options: {
                youtubeTranscript: options.youtubeTranscript,
                mediaTranscript: options.mediaTranscript,
                firecrawl: options.firecrawl,
                format: options.format,
                markdownMode: options.markdownMode ?? null,
                transcriptTimestamps: options.transcriptTimestamps ?? false,
                ...(typeof options.maxCharacters === "number"
                  ? { maxCharacters: options.maxCharacters }
                  : {}),
              },
            })
          : null;
      if (!bypassExtractCache && cacheKey && cacheStore) {
        const cached = cacheStore.getJson<ExtractedLinkContent>("extract", cacheKey);
        if (cached) {
          writeVerbose(
            io.stderr,
            flags.verbose,
            "cache hit extract",
            flags.verboseColor,
            io.envForRun,
          );
          return cached;
        }
        writeVerbose(
          io.stderr,
          flags.verbose,
          "cache miss extract",
          flags.verboseColor,
          io.envForRun,
        );
      }
      try {
        const extracted = await fetchLinkContentWithBirdTip({
          client,
          url: targetUrl,
          options,
          env: io.env,
        });
        if (cacheKey && cacheStore) {
          // Use a short TTL for extracts with unavailable transcripts so that
          // transient transcript failures (e.g. Apify timeouts) are retried on the
          // next run instead of being served from cache for the full default TTL.
          const extractTtlMs =
            extracted.transcriptSource === "unavailable" ? NEGATIVE_TTL_MS : cacheState.ttlMs;
          cacheStore.setJson("extract", cacheKey, extracted, extractTtlMs);
          writeVerbose(
            io.stderr,
            flags.verbose,
            "cache write extract",
            flags.verboseColor,
            io.envForRun,
          );
        }
        return extracted;
      } catch (err) {
        const preferUrlMode =
          typeof urlUtils.shouldPreferUrlMode === "function"
            ? urlUtils.shouldPreferUrlMode(targetUrl)
            : false;
        const isTwitter = urlUtils.isTwitterStatusUrl?.(targetUrl) ?? false;
        const isTikTok = urlUtils.isTikTokVideoUrl?.(targetUrl) ?? false;
        const isDirectMedia =
          typeof urlUtils.isDirectMediaUrl === "function"
            ? urlUtils.isDirectMediaUrl(targetUrl)
            : false;
        const isPodcast = urlUtils.isPodcastHost?.(targetUrl) ?? false;
        if (!preferUrlMode || isTwitter || isTikTok || isDirectMedia || isPodcast) throw err;
        // Fallback: skip HTML fetch and proceed with URL-only extraction (YouTube).
        writeVerbose(
          io.stderr,
          flags.verbose,
          `extract fallback url-only (${(err as Error).message ?? String(err)})`,
          flags.verboseColor,
          io.envForRun,
        );
        return {
          content: "",
          title: null,
          description: null,
          creatorDescription: null,
          url: targetUrl,
          siteName: null,
          wordCount: 0,
          totalCharacters: 0,
          truncated: false,
          mediaDurationSeconds: null,
          video: null,
          isVideoOnly: true,
          transcriptSource: null,
          transcriptCharacters: null,
          transcriptWordCount: null,
          transcriptLines: null,
          transcriptMetadata: null,
          transcriptSegments: null,
          transcriptTimedText: null,
          transcriptionProvider: null,
          diagnostics: {
            strategy: "html",
            firecrawl: {
              attempted: false,
              used: false,
              cacheMode: cacheState.mode,
              cacheStatus: "bypassed",
              notes: "skipped (url-only fallback)",
            },
            markdown: {
              requested: false,
              used: false,
              provider: null,
              notes: "skipped (url fallback)",
            },
            transcript: {
              cacheMode: cacheState.mode,
              cacheStatus: "unknown",
              textProvided: false,
              provider: null,
              attemptedProviders: [],
            },
          },
        };
      }
    };

    let extracted = await fetchWithCache(url);
    let extractionUi = deriveExtractionUi(extracted);

    const extractionMethod: PipelineInfo["extractionMethod"] = (() => {
      const strategy = extracted.diagnostics?.strategy;
      if (strategy === "firecrawl") return "firecrawl";
      if (strategy === "bird") return "bird";
      if (strategy === "xurl") return "xurl";
      if (strategy === "nitter") return "nitter";
      if (extracted.transcriptSource === "whisper") return "audio-transcription";
      if (
        extracted.transcriptSource === "youtubei" ||
        extracted.transcriptSource === "captionTracks"
      )
        return "youtube-captions";
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
        apify: (extracted.diagnostics?.transcript?.attemptedProviders ?? []).includes("apify"),
      },
    });

    logExtractionDiagnostics({
      extracted,
      stderr: io.stderr,
      verbose: flags.verbose,
      verboseColor: flags.verboseColor,
      env: io.envForRun,
    });
    const transcriptCacheStatus = extracted.diagnostics?.transcript?.cacheStatus;
    if (transcriptCacheStatus && transcriptCacheStatus !== "unknown") {
      writeVerbose(
        io.stderr,
        flags.verbose,
        `cache ${transcriptCacheStatus} transcript`,
        flags.verboseColor,
        io.envForRun,
      );
    }

    if (
      flags.extractMode &&
      markdown.markdownRequested &&
      flags.preprocessMode !== "off" &&
      markdown.effectiveMarkdownMode === "auto" &&
      !extracted.diagnostics.markdown.used &&
      !hasUvxCli(io.env)
    ) {
      io.stderr.write(`${UVX_TIP}\n`);
    }

    if (!isYoutubeUrl && extracted.isVideoOnly && extracted.video) {
      if (extracted.video.kind === "youtube") {
        writeVerbose(
          io.stderr,
          flags.verbose,
          `video-only page detected; switching to YouTube URL ${extracted.video.url}`,
          flags.verboseColor,
          io.envForRun,
        );
        extracted = await fetchWithCache(extracted.video.url);
        extractionUi = deriveExtractionUi(extracted);
      } else if (extracted.video.kind === "direct") {
        const wantsVideoUnderstanding =
          flags.videoMode === "understand" || flags.videoMode === "auto";
        const isGeminiModel =
          model.modelId.startsWith("gemini/") || model.modelId.includes("gemini");
        const canVideoUnderstand = wantsVideoUnderstanding && isGeminiModel;

        if (canVideoUnderstand) {
          hooks.onExtracted?.(extracted);
          const loadedVideo = await loadRemoteAsset({
            url: extracted.video.url,
            fetchImpl: io.fetch,
            timeoutMs: flags.timeoutMs,
          });
          assertAssetMediaTypeSupported({ attachment: loadedVideo.attachment, sizeLabel: null });

          let chosenModel: string | null = null;
          await hooks.summarizeAsset({
            sourceKind: "asset-url",
            sourceLabel: loadedVideo.sourceLabel,
            attachment: loadedVideo.attachment,
            onModelChosen: (modelId) => {
              chosenModel = modelId;
              hooks.onModelChosen?.(modelId);
            },
          });
          hooks.writeViaFooter([
            ...extractionUi.footerParts,
            ...(chosenModel ? [`model ${chosenModel}`] : []),
          ]);
          return;
        }
      }
    }

    hooks.onExtracted?.(extracted);

    const prompt = buildUrlPrompt({
      extracted,
      outputLanguage: flags.outputLanguage,
      lengthArg: flags.lengthArg,
      promptOverride: flags.promptOverride ?? null,
      lengthInstruction: flags.lengthInstruction ?? null,
      languageInstruction: flags.languageInstruction ?? null,
    });

    // Whisper transcription costs need to be folded into the finish line totals.
    const transcriptionCostUsd = estimateWhisperTranscriptionCostUsd({
      transcriptionProvider: extracted.transcriptionProvider,
      transcriptSource: extracted.transcriptSource,
      mediaDurationSeconds: extracted.mediaDurationSeconds,
      openaiWhisperUsdPerMinute: 0.006,
    });
    const transcriptionCostLabel =
      typeof transcriptionCostUsd === "number" ? `txcost=${formatUSD(transcriptionCostUsd)}` : null;
    hooks.setTranscriptionCost(transcriptionCostUsd, transcriptionCostLabel);

    if (flags.extractMode) {
      // Apply transcript→markdown conversion if requested
      let extractedForOutput = extracted;
      if (markdown.transcriptMarkdownRequested && markdown.convertTranscriptToMarkdown) {
        const markdownContent = await markdown.convertTranscriptToMarkdown({
          title: extracted.title,
          source: extracted.siteName,
          transcript: extracted.content,
          timeoutMs: flags.timeoutMs,
          outputLanguage: flags.outputLanguage,
        });
        extractedForOutput = {
          ...extracted,
          content: markdownContent,
          diagnostics: {
            ...extracted.diagnostics,
            markdown: {
              ...extracted.diagnostics.markdown,
              requested: true,
              used: true,
              provider: "llm",
              notes: "transcript",
            },
          },
        };
        extractionUi = deriveExtractionUi(extractedForOutput);
      }
      await outputExtractedUrl({
        ctx,
        url,
        extracted: extractedForOutput,
        extractionUi,
        prompt,
        effectiveMarkdownMode: markdown.effectiveMarkdownMode,
        transcriptionCostLabel,
      });
      return;
    }

    const onModelChosen = (modelId: string) => {
      hooks.onModelChosen?.(modelId);
    };

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
      });
    });
  } finally {
    hooks.clearProgressIfCurrent(() => {});
  }
}
