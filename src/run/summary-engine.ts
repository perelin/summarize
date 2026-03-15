import { countTokens } from "gpt-tokenizer";
import { formatCompactCount } from "../core/shared/format.js";
import { streamTextWithModelId } from "../llm/generate-text.js";
import { parseGatewayStyleModelId } from "../llm/model-id.js";
import type { Prompt } from "../llm/prompt.js";
import { createRetryLogger, writeVerbose } from "./logging.js";
import {
  canStream,
  isGoogleStreamingUnsupportedError,
  isStreamingTimeoutError,
  mergeStreamingChunk,
} from "./streaming.js";
import { resolveModelIdForLlmCall, summarizeWithModelId } from "./summary-llm.js";
import type { ModelAttempt, ModelMeta } from "./types.js";

export type SummaryEngineDeps = {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  timeoutMs: number;
  retries: number;
  streamingEnabled: boolean;
  verbose: boolean;
  verboseColor: boolean;
  openaiUseChatCompletions: boolean;
  trackedFetch: typeof fetch;
  resolveMaxOutputTokensForCall: (modelId: string) => Promise<number | null>;
  resolveMaxInputTokensForCall: (modelId: string) => Promise<number | null>;
  llmCalls: Array<{
    provider: "xai" | "openai" | "google" | "anthropic" | "zai" | "nvidia";
    model: string;
    usage: Awaited<ReturnType<typeof summarizeWithModelId>>["usage"] | null;
    costUsd?: number | null;
    purpose: "summary" | "markdown";
  }>;
  clearProgressForStdout: () => void;
  restoreProgressAfterStdout?: (() => void) | null;
  apiKeys: {
    xaiApiKey: string | null;
    openaiApiKey: string | null;
    googleApiKey: string | null;
    anthropicApiKey: string | null;
    openrouterApiKey: string | null;
  };
  keyFlags: {
    googleConfigured: boolean;
    anthropicConfigured: boolean;
    openrouterConfigured: boolean;
  };
  zai: {
    apiKey: string | null;
    baseUrl: string;
  };
  nvidia: {
    apiKey: string | null;
    baseUrl: string;
  };
  providerBaseUrls: {
    openai: string | null;
    anthropic: string | null;
    google: string | null;
    xai: string | null;
  };
};

export type SummaryStreamHandler = {
  onChunk: (args: {
    streamed: string;
    prevStreamed: string;
    appended: string;
  }) => void | Promise<void>;
  onDone?: ((finalText: string) => void | Promise<void>) | null;
};

export function createSummaryEngine(deps: SummaryEngineDeps) {
  const applyOpenAiGatewayOverrides = (attempt: ModelAttempt): ModelAttempt => {
    const modelIdLower = attempt.userModelId.toLowerCase();
    if (modelIdLower.startsWith("zai/")) {
      return {
        ...attempt,
        openaiApiKeyOverride: deps.zai.apiKey,
        openaiBaseUrlOverride: deps.zai.baseUrl,
        forceChatCompletions: true,
      };
    }
    if (modelIdLower.startsWith("nvidia/")) {
      return {
        ...attempt,
        openaiApiKeyOverride: deps.nvidia.apiKey,
        openaiBaseUrlOverride: deps.nvidia.baseUrl,
        forceChatCompletions: true,
      };
    }
    return attempt;
  };

  const envHasKeyFor = (requiredEnv: ModelAttempt["requiredEnv"]) => {
    if (requiredEnv === "GEMINI_API_KEY") {
      return deps.keyFlags.googleConfigured;
    }
    if (requiredEnv === "OPENROUTER_API_KEY") {
      return deps.keyFlags.openrouterConfigured;
    }
    if (requiredEnv === "OPENAI_API_KEY") {
      return Boolean(deps.apiKeys.openaiApiKey);
    }
    if (requiredEnv === "NVIDIA_API_KEY") {
      return Boolean(deps.nvidia.apiKey);
    }
    if (requiredEnv === "Z_AI_API_KEY") {
      return Boolean(deps.zai.apiKey);
    }
    if (requiredEnv === "XAI_API_KEY") {
      return Boolean(deps.apiKeys.xaiApiKey);
    }
    return Boolean(deps.apiKeys.anthropicApiKey);
  };

  const formatMissingModelError = (attempt: ModelAttempt): string => {
    return `Missing ${attempt.requiredEnv} for model ${attempt.userModelId}. Set the env var or choose a different --model.`;
  };

  const runSummaryAttempt = async ({
    attempt,
    prompt,
    allowStreaming,
    onModelChosen,
    streamHandler,
  }: {
    attempt: ModelAttempt;
    prompt: Prompt;
    allowStreaming: boolean;
    onModelChosen?: ((modelId: string) => void) | null;
    streamHandler?: SummaryStreamHandler | null;
  }): Promise<{
    summary: string;
    summaryAlreadyPrinted: boolean;
    modelMeta: ModelMeta;
    maxOutputTokensForCall: number | null;
  }> => {
    onModelChosen?.(attempt.userModelId);

    if (!attempt.llmModelId) {
      throw new Error(`Missing model id for ${attempt.userModelId}.`);
    }
    const parsedModel = parseGatewayStyleModelId(attempt.llmModelId);
    const apiKeysForLlm = {
      xaiApiKey: deps.apiKeys.xaiApiKey,
      openaiApiKey: attempt.openaiApiKeyOverride ?? deps.apiKeys.openaiApiKey,
      googleApiKey: deps.keyFlags.googleConfigured ? deps.apiKeys.googleApiKey : null,
      anthropicApiKey: deps.keyFlags.anthropicConfigured ? deps.apiKeys.anthropicApiKey : null,
      openrouterApiKey: deps.keyFlags.openrouterConfigured ? deps.apiKeys.openrouterApiKey : null,
    };

    const modelResolution = await resolveModelIdForLlmCall({
      parsedModel,
      apiKeys: { googleApiKey: apiKeysForLlm.googleApiKey },
      fetchImpl: deps.trackedFetch,
      timeoutMs: deps.timeoutMs,
    });
    if (modelResolution.note && deps.verbose) {
      writeVerbose(
        deps.stderr,
        deps.verbose,
        modelResolution.note,
        deps.verboseColor,
        deps.envForRun,
      );
    }
    const parsedModelEffective = parseGatewayStyleModelId(modelResolution.modelId);
    const streamingEnabledForCall =
      allowStreaming &&
      deps.streamingEnabled &&
      !modelResolution.forceStreamOff &&
      canStream({
        provider: parsedModelEffective.provider,
        prompt,
        transport: attempt.transport === "openrouter" ? "openrouter" : "native",
      });
    const forceChatCompletions =
      Boolean(attempt.forceChatCompletions) ||
      (deps.openaiUseChatCompletions && parsedModelEffective.provider === "openai");

    const maxOutputTokensForCall = await deps.resolveMaxOutputTokensForCall(
      parsedModelEffective.canonical,
    );
    const maxInputTokensForCall = await deps.resolveMaxInputTokensForCall(
      parsedModelEffective.canonical,
    );
    if (
      typeof maxInputTokensForCall === "number" &&
      Number.isFinite(maxInputTokensForCall) &&
      maxInputTokensForCall > 0 &&
      (prompt.attachments?.length ?? 0) === 0
    ) {
      const tokenCount = countTokens(prompt.userText);
      if (tokenCount > maxInputTokensForCall) {
        throw new Error(
          `Input token count (${formatCompactCount(tokenCount)}) exceeds model input limit (${formatCompactCount(maxInputTokensForCall)}). Tokenized with GPT tokenizer; prompt included.`,
        );
      }
    }

    if (!streamingEnabledForCall) {
      const result = await summarizeWithModelId({
        modelId: parsedModelEffective.canonical,
        prompt,
        maxOutputTokens: maxOutputTokensForCall ?? undefined,
        timeoutMs: deps.timeoutMs,
        fetchImpl: deps.trackedFetch,
        apiKeys: apiKeysForLlm,
        forceOpenRouter: attempt.forceOpenRouter,
        openaiBaseUrlOverride: attempt.openaiBaseUrlOverride ?? deps.providerBaseUrls.openai,
        anthropicBaseUrlOverride: deps.providerBaseUrls.anthropic,
        googleBaseUrlOverride: deps.providerBaseUrls.google,
        xaiBaseUrlOverride: deps.providerBaseUrls.xai,
        zaiBaseUrlOverride: deps.zai.baseUrl,
        forceChatCompletions,
        retries: deps.retries,
        onRetry: createRetryLogger({
          stderr: deps.stderr,
          verbose: deps.verbose,
          color: deps.verboseColor,
          modelId: parsedModelEffective.canonical,
          env: deps.envForRun,
        }),
      });
      deps.llmCalls.push({
        provider: result.provider,
        model: result.canonicalModelId,
        usage: result.usage,
        purpose: "summary",
      });
      const summary = result.text.trim();
      if (!summary) throw new Error("LLM returned an empty summary");
      const displayCanonical = attempt.userModelId.toLowerCase().startsWith("openrouter/")
        ? attempt.userModelId
        : parsedModelEffective.canonical;
      return {
        summary,
        summaryAlreadyPrinted: false,
        modelMeta: {
          provider: parsedModelEffective.provider,
          canonical: displayCanonical,
        },
        maxOutputTokensForCall: maxOutputTokensForCall ?? null,
      };
    }

    let summaryAlreadyPrinted = false;
    let summary = "";
    let getLastStreamError: (() => unknown) | null = null;

    let streamResult: Awaited<ReturnType<typeof streamTextWithModelId>> | null = null;
    try {
      streamResult = await streamTextWithModelId({
        modelId: parsedModelEffective.canonical,
        apiKeys: apiKeysForLlm,
        forceOpenRouter: attempt.forceOpenRouter,
        openaiBaseUrlOverride: attempt.openaiBaseUrlOverride ?? deps.providerBaseUrls.openai,
        anthropicBaseUrlOverride: deps.providerBaseUrls.anthropic,
        googleBaseUrlOverride: deps.providerBaseUrls.google,
        xaiBaseUrlOverride: deps.providerBaseUrls.xai,
        forceChatCompletions,
        prompt,
        temperature: 0,
        maxOutputTokens: maxOutputTokensForCall ?? undefined,
        timeoutMs: deps.timeoutMs,
        fetchImpl: deps.trackedFetch,
      });
    } catch (error) {
      if (isStreamingTimeoutError(error)) {
        writeVerbose(
          deps.stderr,
          deps.verbose,
          `Streaming timed out for ${parsedModelEffective.canonical}; falling back to non-streaming.`,
          deps.verboseColor,
          deps.envForRun,
        );
        const result = await summarizeWithModelId({
          modelId: parsedModelEffective.canonical,
          prompt,
          maxOutputTokens: maxOutputTokensForCall ?? undefined,
          timeoutMs: deps.timeoutMs,
          fetchImpl: deps.trackedFetch,
          apiKeys: apiKeysForLlm,
          forceOpenRouter: attempt.forceOpenRouter,
          openaiBaseUrlOverride: attempt.openaiBaseUrlOverride ?? deps.providerBaseUrls.openai,
          anthropicBaseUrlOverride: deps.providerBaseUrls.anthropic,
          googleBaseUrlOverride: deps.providerBaseUrls.google,
          xaiBaseUrlOverride: deps.providerBaseUrls.xai,
          zaiBaseUrlOverride: deps.zai.baseUrl,
          forceChatCompletions,
          retries: deps.retries,
          onRetry: createRetryLogger({
            stderr: deps.stderr,
            verbose: deps.verbose,
            color: deps.verboseColor,
            modelId: parsedModelEffective.canonical,
            env: deps.envForRun,
          }),
        });
        deps.llmCalls.push({
          provider: result.provider,
          model: result.canonicalModelId,
          usage: result.usage,
          purpose: "summary",
        });
        summary = result.text;
        streamResult = null;
      } else if (
        parsedModelEffective.provider === "google" &&
        isGoogleStreamingUnsupportedError(error)
      ) {
        writeVerbose(
          deps.stderr,
          deps.verbose,
          `Google model ${parsedModelEffective.canonical} rejected streamGenerateContent; falling back to non-streaming.`,
          deps.verboseColor,
          deps.envForRun,
        );
        const result = await summarizeWithModelId({
          modelId: parsedModelEffective.canonical,
          prompt,
          maxOutputTokens: maxOutputTokensForCall ?? undefined,
          timeoutMs: deps.timeoutMs,
          fetchImpl: deps.trackedFetch,
          apiKeys: apiKeysForLlm,
          forceOpenRouter: attempt.forceOpenRouter,
          openaiBaseUrlOverride: attempt.openaiBaseUrlOverride ?? deps.providerBaseUrls.openai,
          anthropicBaseUrlOverride: deps.providerBaseUrls.anthropic,
          googleBaseUrlOverride: deps.providerBaseUrls.google,
          xaiBaseUrlOverride: deps.providerBaseUrls.xai,
          zaiBaseUrlOverride: deps.zai.baseUrl,
          retries: deps.retries,
          onRetry: createRetryLogger({
            stderr: deps.stderr,
            verbose: deps.verbose,
            color: deps.verboseColor,
            modelId: parsedModelEffective.canonical,
            env: deps.envForRun,
          }),
        });
        deps.llmCalls.push({
          provider: result.provider,
          model: result.canonicalModelId,
          usage: result.usage,
          purpose: "summary",
        });
        summary = result.text;
        streamResult = null;
      } else {
        throw error;
      }
    }

    if (streamResult) {
      deps.clearProgressForStdout();
      deps.restoreProgressAfterStdout?.();
      getLastStreamError = streamResult.lastError;
      let streamed = "";
      let streamedRaw = "";

      try {
        for await (const delta of streamResult.textStream) {
          const prevStreamed = streamed;
          const merged = mergeStreamingChunk(streamed, delta);
          streamed = merged.next;
          if (streamHandler) {
            await streamHandler.onChunk({
              streamed: merged.next,
              prevStreamed,
              appended: merged.appended,
            });
          }
        }

        streamedRaw = streamed;
        const trimmed = streamed.trim();
        streamed = trimmed;
      } finally {
        if (streamHandler) {
          await streamHandler.onDone?.(streamedRaw || streamed);
          summaryAlreadyPrinted = true;
        }
      }
      const usage = await streamResult.usage;
      deps.llmCalls.push({
        provider: streamResult.provider,
        model: streamResult.canonicalModelId,
        usage,
        purpose: "summary",
      });
      summary = streamed;
    }

    summary = summary.trim();
    if (summary.length === 0) {
      const last = getLastStreamError?.();
      if (last instanceof Error) {
        throw new Error(last.message, { cause: last });
      }
      throw new Error("LLM returned an empty summary");
    }

    if (!streamResult && streamHandler) {
      const cleaned = summary.trim();
      await streamHandler.onChunk({ streamed: cleaned, prevStreamed: "", appended: cleaned });
      await streamHandler.onDone?.(cleaned);
      summaryAlreadyPrinted = true;
    }

    return {
      summary,
      summaryAlreadyPrinted,
      modelMeta: {
        provider: parsedModelEffective.provider,
        canonical: attempt.userModelId.toLowerCase().startsWith("openrouter/")
          ? attempt.userModelId
          : parsedModelEffective.canonical,
      },
      maxOutputTokensForCall: maxOutputTokensForCall ?? null,
    };
  };

  return {
    applyOpenAiGatewayOverrides,
    envHasKeyFor,
    formatMissingModelError,
    runSummaryAttempt,
  };
}
