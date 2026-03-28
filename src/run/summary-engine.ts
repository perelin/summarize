import { countTokens } from "gpt-tokenizer";
import { formatCompactCount } from "../core/shared/format.js";
import { streamText, type LiteLlmConnection } from "../llm/generate-text.js";
import type { Prompt } from "../llm/prompt.js";
import type { LlmTokenUsage } from "../llm/types.js";
import { writeVerbose } from "./logging.js";
import { mergeStreamingChunk } from "./streaming.js";
import { summarizeWithModel } from "./summary-llm.js";
import type { ModelMeta } from "./types.js";

export type SummaryEngineDeps = {
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  timeoutMs: number;
  streamingEnabled: boolean;
  verbose: boolean;
  verboseColor: boolean;
  connection: LiteLlmConnection;
  modelId: string;
  resolveMaxOutputTokensForCall: (modelId: string) => Promise<number | null>;
  resolveMaxInputTokensForCall: (modelId: string) => Promise<number | null>;
  llmCalls: Array<{
    model: string;
    usage: LlmTokenUsage | null;
    costUsd?: number | null;
    purpose: "summary" | "markdown";
  }>;
  clearProgressForStdout: () => void;
  restoreProgressAfterStdout?: (() => void) | null;
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
  const runSummary = async ({
    prompt,
    allowStreaming,
    onModelChosen,
    streamHandler,
  }: {
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
    onModelChosen?.(deps.modelId);

    const maxOutputTokensForCall = await deps.resolveMaxOutputTokensForCall(deps.modelId);
    const maxInputTokensForCall = await deps.resolveMaxInputTokensForCall(deps.modelId);

    // Check input token limit (only for text-only prompts; skip when attachments are present)
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

    const streamingEnabledForCall = allowStreaming && deps.streamingEnabled;

    // --- Non-streaming path ---
    if (!streamingEnabledForCall) {
      const result = await summarizeWithModel({
        modelId: deps.modelId,
        connection: deps.connection,
        prompt,
        maxOutputTokens: maxOutputTokensForCall ?? undefined,
        timeoutMs: deps.timeoutMs,
      });
      deps.llmCalls.push({
        model: result.modelId,
        usage: result.usage,
        purpose: "summary",
      });
      const summary = result.text.trim();
      if (!summary) throw new Error("LLM returned an empty summary");

      // If a stream handler was provided but we used non-streaming, replay the result
      if (streamHandler) {
        const cleaned = summary.trim();
        await streamHandler.onChunk({ streamed: cleaned, prevStreamed: "", appended: cleaned });
        await streamHandler.onDone?.(cleaned);
        return {
          summary,
          summaryAlreadyPrinted: true,
          modelMeta: { model: deps.modelId },
          maxOutputTokensForCall: maxOutputTokensForCall ?? null,
        };
      }

      return {
        summary,
        summaryAlreadyPrinted: false,
        modelMeta: { model: deps.modelId },
        maxOutputTokensForCall: maxOutputTokensForCall ?? null,
      };
    }

    // --- Streaming path ---
    let summaryAlreadyPrinted = false;
    let summary = "";
    let getLastStreamError: (() => unknown) | null = null;

    let streamResult: Awaited<ReturnType<typeof streamText>> | null = null;
    try {
      streamResult = await streamText({
        modelId: deps.modelId,
        connection: deps.connection,
        prompt,
        temperature: 0,
        maxOutputTokens: maxOutputTokensForCall ?? undefined,
        timeoutMs: deps.timeoutMs,
      });
    } catch (error) {
      // On any streaming error, fall back to non-streaming
      const isTimeout =
        error instanceof Error && /timed out/i.test(error.message);
      if (isTimeout) {
        writeVerbose(
          deps.stderr,
          deps.verbose,
          `Streaming timed out for ${deps.modelId}; falling back to non-streaming.`,
          deps.verboseColor,
          deps.envForRun,
        );
      }
      if (isTimeout) {
        const result = await summarizeWithModel({
          modelId: deps.modelId,
          connection: deps.connection,
          prompt,
          maxOutputTokens: maxOutputTokensForCall ?? undefined,
          timeoutMs: deps.timeoutMs,
        });
        deps.llmCalls.push({
          model: result.modelId,
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
        model: streamResult.modelId,
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

    // If we fell back to non-streaming but a stream handler was provided, replay the result
    if (!streamResult && streamHandler) {
      const cleaned = summary.trim();
      await streamHandler.onChunk({ streamed: cleaned, prevStreamed: "", appended: cleaned });
      await streamHandler.onDone?.(cleaned);
      summaryAlreadyPrinted = true;
    }

    return {
      summary,
      summaryAlreadyPrinted,
      modelMeta: { model: deps.modelId },
      maxOutputTokensForCall: maxOutputTokensForCall ?? null,
    };
  };

  return { runSummary, modelId: deps.modelId };
}
