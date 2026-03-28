import { completeSimple, streamSimple } from "@mariozechner/pi-ai";
import type { Api, Context, Message, Model } from "@mariozechner/pi-ai";
import type { Prompt } from "./prompt.js";
import { userTextAndImageMessage } from "./prompt.js";
import type { LlmTokenUsage } from "./types.js";
import { normalizeTokenUsage } from "./usage.js";

export type { LlmTokenUsage } from "./types.js";

export type LiteLlmConnection = {
  baseUrl: string;
  apiKey: string | null;
};

/**
 * Ensure pi-ai can authenticate with the LiteLLM gateway.
 *
 * pi-ai reads API keys from `process.env.OPENAI_API_KEY` (ignoring the
 * `apiKey` option passed to completeSimple/streamSimple). We set it here
 * so all subsequent calls authenticate correctly.
 */
function ensureApiKeyInEnv(connection: LiteLlmConnection): void {
  if (connection.apiKey) {
    process.env.OPENAI_API_KEY = connection.apiKey;
  }
}

function promptToContext(prompt: Prompt): Context {
  const attachments = prompt.attachments ?? [];
  if (attachments.length === 0) {
    return {
      systemPrompt: prompt.system,
      messages: [{ role: "user", content: prompt.userText, timestamp: Date.now() }],
    };
  }
  if (attachments.length === 1 && attachments[0]?.kind === "image") {
    const attachment = attachments[0];
    const messages: Message[] = [
      userTextAndImageMessage({
        text: prompt.userText,
        imageBytes: attachment.bytes,
        mimeType: attachment.mediaType,
      }),
    ];
    return { systemPrompt: prompt.system, messages };
  }
  if (attachments.length === 1 && attachments[0]?.kind === "document") {
    // TODO: Binary documents (PDFs) are preprocessed to text by the asset pipeline
    // before reaching this point. If direct document attachment support is needed
    // in the future, LiteLLM would need to support provider-specific document APIs.
    throw new Error("Document attachments are not yet supported via LiteLLM gateway.");
  }
  throw new Error("Internal error: unsupported attachment combination.");
}

function wantsImages(context: Context): boolean {
  for (const msg of context.messages) {
    if (msg.role === "user" || msg.role === "toolResult") {
      if (Array.isArray(msg.content) && msg.content.some((c) => c.type === "image")) return true;
    }
  }
  return false;
}

/**
 * Create a pi-ai Model pointing at LiteLLM.
 *
 * Uses "openai-completions" API since LiteLLM exposes an OpenAI-compatible endpoint.
 * The model ID is passed through to LiteLLM as-is (e.g. "mistral/mistral-large-latest").
 */
function createLiteLlmModel(
  connection: LiteLlmConnection,
  modelId: string,
  context: Context,
): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "openai",
    baseUrl: connection.baseUrl,
    reasoning: false,
    input: wantsImages(context) ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // These values are hardcoded for the default Mistral Large model (256k context).
    // When switching models via config, LiteLLM handles the actual limits —
    // these only affect client-side token counting heuristics.
    contextWindow: 256_000,
    maxTokens: 16_384,
  };
}

function extractText(result: { content: ReadonlyArray<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: string; text: string }).text)
    .join("")
    .trim();
}

export async function generateText({
  modelId,
  connection,
  prompt,
  temperature,
  maxOutputTokens,
  timeoutMs,
}: {
  modelId: string;
  connection: LiteLlmConnection;
  prompt: Prompt;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<{
  text: string;
  modelId: string;
  usage: LlmTokenUsage | null;
}> {
  ensureApiKeyInEnv(connection);
  const context = promptToContext(prompt);
  const model = createLiteLlmModel(connection, modelId, context);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await completeSimple(model, context, {
      ...(typeof temperature === "number" ? { temperature } : {}),
      ...(typeof maxOutputTokens === "number" ? { maxTokens: maxOutputTokens } : {}),
      apiKey: connection.apiKey ?? "not-needed",
      signal: controller.signal,
    });

    const text = extractText(result);
    if (!text) throw new Error(`LLM returned an empty response (model ${modelId}).`);

    return {
      text,
      modelId,
      usage: normalizeTokenUsage(result.usage),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`LLM request timed out after ${timeoutMs}ms (model ${modelId}).`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function streamUsageWithTimeout({
  result,
  timeoutMs,
}: {
  result: Promise<{ usage?: unknown }>;
  timeoutMs: number;
}): Promise<LlmTokenUsage | null> {
  const normalized = result.then((msg) => normalizeTokenUsage(msg.usage)).catch(() => null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    normalized,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function streamText({
  modelId,
  connection,
  prompt,
  temperature,
  maxOutputTokens,
  timeoutMs,
}: {
  modelId: string;
  connection: LiteLlmConnection;
  prompt: Prompt;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<{
  textStream: AsyncIterable<string>;
  modelId: string;
  usage: Promise<LlmTokenUsage | null>;
  lastError: () => unknown;
}> {
  const context = promptToContext(prompt);
  return streamTextWithContext({
    modelId,
    connection,
    context,
    temperature,
    maxOutputTokens,
    timeoutMs,
  });
}

export async function streamTextWithContext({
  modelId,
  connection,
  context,
  temperature,
  maxOutputTokens,
  timeoutMs,
}: {
  modelId: string;
  connection: LiteLlmConnection;
  context: Context;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<{
  textStream: AsyncIterable<string>;
  modelId: string;
  usage: Promise<LlmTokenUsage | null>;
  lastError: () => unknown;
}> {
  ensureApiKeyInEnv(connection);
  const model = createLiteLlmModel(connection, modelId, context);
  const controller = new AbortController();
  let lastError: unknown = null;
  const startedAtMs = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutError = new Error("LLM request timed out");

  const markTimedOut = () => {
    if (lastError === timeoutError) return;
    lastError = timeoutError;
    controller.abort();
  };

  const startTimeout = () => {
    if (timeoutId) return;
    timeoutId = setTimeout(markTimedOut, timeoutMs);
  };

  const stopTimeout = () => {
    if (!timeoutId) return;
    clearTimeout(timeoutId);
    timeoutId = null;
  };

  const nextWithDeadline = async <T>(promise: Promise<T>): Promise<T> => {
    const elapsed = Date.now() - startedAtMs;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      markTimedOut();
      throw timeoutError;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            markTimedOut();
            reject(timeoutError);
          }, remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const stream = streamSimple(model, context, {
    ...(typeof temperature === "number" ? { temperature } : {}),
    ...(typeof maxOutputTokens === "number" ? { maxTokens: maxOutputTokens } : {}),
    apiKey: connection.apiKey ?? "not-needed",
    signal: controller.signal,
  });

  const textStream: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {
      startTimeout();
      const iterator = stream[Symbol.asyncIterator]();
      try {
        while (true) {
          const result = await nextWithDeadline(iterator.next());
          if (result.done) break;
          const event = result.value;
          if (event.type === "text_delta") yield event.delta;
          if (event.type === "error") {
            lastError = event.error;
            break;
          }
        }
      } finally {
        stopTimeout();
        if (typeof iterator.return === "function") {
          const cleanup = iterator.return();
          const cleanupPromise =
            typeof cleanup === "undefined" ? undefined : (cleanup as Promise<unknown>);
          if (typeof cleanupPromise?.catch === "function") {
            void cleanupPromise.catch(() => {});
          }
        }
      }
    },
  };

  return {
    textStream,
    modelId,
    usage: streamUsageWithTimeout({ result: stream.result(), timeoutMs }),
    lastError: () => lastError,
  };
}
