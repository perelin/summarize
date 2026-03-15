import type { Context, Message } from "@mariozechner/pi-ai";
import type { SummarizeConfig } from "../config.js";
import type { LlmApiKeys } from "../llm/generate-text.js";
import { streamTextWithContext } from "../llm/generate-text.js";
import { buildAutoModelAttempts, envHasKey } from "../model-auto.js";
import { parseRequestedModelId } from "../model-spec.js";
import { resolveEnvState } from "../run/run-env.js";

type ChatEvent = { event: string; data?: unknown };

/**
 * Context for web server chat — loaded from the history store by summaryId.
 */
export type WebChatContext = {
  summaryId: string;
  /** The summary text to ground the conversation in. */
  summary: string;
  /** Full extracted source text (transcript for media, article body, etc.). */
  sourceText?: string;
  /** Original URL that was summarized (optional). */
  sourceUrl?: string;
  /** Page title from the summary (optional). */
  sourceTitle?: string;
  /** Prior chat messages for this summary. */
  history: Array<{ role: "user" | "assistant"; content: string }>;
};

/** Callback type for receiving streamed chat tokens. */
export type WebChatSink = {
  onChunk: (text: string) => void;
  onModel: (model: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
};

const SYSTEM_PROMPT = `You are Summarize_p2 Chat.

You answer questions about the original source document. Keep responses concise and grounded in the source material.`;

function normalizeMessages(messages: Message[]): Message[] {
  return messages.map((message) => ({
    ...message,
    timestamp: message.timestamp ?? Date.now(),
  }));
}

function resolveApiKeys(
  env: Record<string, string | undefined>,
  configForCli: SummarizeConfig | null,
): LlmApiKeys {
  const envState = resolveEnvState({ env, envForRun: env, configForCli });
  return {
    xaiApiKey: envState.xaiApiKey,
    openaiApiKey: envState.apiKey ?? envState.openaiTranscriptionKey,
    googleApiKey: envState.googleApiKey,
    anthropicApiKey: envState.anthropicApiKey,
    openrouterApiKey: envState.openrouterApiKey,
  };
}

/**
 * Build the LLM context for a web chat request.
 *
 * Constructs a system prompt that includes the summary as grounding context,
 * then maps the chat history into pi-ai Message format.
 */
function buildWebChatContext(ctx: WebChatContext, userMessage: string): Context {
  const header = ctx.sourceTitle
    ? `${ctx.sourceTitle}${ctx.sourceUrl ? ` (${ctx.sourceUrl})` : ""}`
    : (ctx.sourceUrl ?? "content");

  // When the full source text is available, include it so the LLM can answer
  // questions about details not covered in the summary.
  const sourceSection = ctx.sourceText
    ? `\n\nFull source text of ${header}:\n${ctx.sourceText}\n\nSummary:\n${ctx.summary}`
    : `\n\nSummary of ${header}:\n${ctx.summary}`;

  const systemPrompt = `${SYSTEM_PROMPT}${sourceSection}`;

  const messages: Message[] = [];

  // Map prior chat history into pi-ai Message format
  for (const msg of ctx.history) {
    if (msg.role === "user") {
      messages.push({
        role: "user",
        content: msg.content,
        timestamp: Date.now(),
      });
    } else {
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: msg.content }],
        api: "openai",
        provider: "openai",
        model: "unknown",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      } as Message);
    }
  }

  // Add the new user message
  messages.push({
    role: "user",
    content: userMessage,
    timestamp: Date.now(),
  });

  return { systemPrompt, messages: normalizeMessages(messages) };
}

/**
 * Stream a chat response for the web server.
 *
 * Accepts a `WebChatContext` loaded from the history store by summaryId.
 *
 * Returns the model used and the full response text.
 */
export async function streamWebChatResponse({
  env,
  fetchImpl,
  config = null,
  webContext,
  userMessage,
  modelOverride,
  sink,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  config?: SummarizeConfig | null;
  webContext: WebChatContext;
  userMessage: string;
  modelOverride: string | null;
  sink: WebChatSink;
}): Promise<{ usedModel: string; responseText: string }> {
  const apiKeys = resolveApiKeys(env, config);
  const context = buildWebChatContext(webContext, userMessage);
  const chunks: string[] = [];
  let usedModel = "unknown";

  const resolveModel = () => {
    if (modelOverride && modelOverride.trim().length > 0) {
      const requested = parseRequestedModelId(modelOverride);
      if (requested.kind === "auto") {
        return null;
      }
      if (requested.transport === "cli") {
        throw new Error(`CLI transport is not supported in server mode (model: ${modelOverride}).`);
      }
      return {
        userModelId: requested.userModelId,
        modelId: requested.llmModelId,
        forceOpenRouter: requested.forceOpenRouter,
        transport: "native" as const,
      };
    }
    return null;
  };

  const streamWithModel = async (modelId: string, forceOpenRouter: boolean): Promise<void> => {
    const result = await streamTextWithContext({
      modelId,
      apiKeys,
      context,
      timeoutMs: 60_000,
      fetchImpl,
      forceOpenRouter,
    });
    for await (const chunk of result.textStream) {
      chunks.push(chunk);
      sink.onChunk(chunk);
    }
  };

  try {
    const resolved = resolveModel();
    if (resolved) {
      usedModel = resolved.userModelId;
      sink.onModel(usedModel);
      await streamWithModel(resolved.modelId!, resolved.forceOpenRouter);
    } else {
      // Auto-select model
      const envState = resolveEnvState({ env, envForRun: env, configForCli: config });
      const attempts = buildAutoModelAttempts({
        kind: "text",
        promptTokens: null,
        desiredOutputTokens: null,
        requiresVideoUnderstanding: false,
        env: envState.envForAuto,
        config: null,
        catalog: null,
        openrouterProvidersFromEnv: null,
        cliAvailability: envState.cliAvailability,
      });

      const apiAttempt = attempts.find(
        (entry) =>
          entry.transport !== "cli" &&
          entry.llmModelId &&
          envHasKey(envState.envForAuto, entry.requiredEnv),
      );
      if (!apiAttempt) {
        throw new Error("No model available for chat");
      }

      usedModel = apiAttempt.userModelId;
      sink.onModel(usedModel);
      await streamWithModel(apiAttempt.llmModelId!, apiAttempt.forceOpenRouter);
    }

    sink.onDone();
  } catch (err) {
    sink.onError(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }

  return { usedModel, responseText: chunks.join("") };
}
