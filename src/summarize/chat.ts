import type { Context, Message } from "@mariozechner/pi-ai";
import { streamTextWithContext, type LiteLlmConnection } from "../llm/generate-text.js";

type ChatEvent = { event: string; data?: unknown };

export type WebChatContext = {
  summaryId: string;
  summary: string;
  sourceText?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
};

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

function buildWebChatContext(ctx: WebChatContext, userMessage: string): Context {
  const header = ctx.sourceTitle
    ? `${ctx.sourceTitle}${ctx.sourceUrl ? ` (${ctx.sourceUrl})` : ""}`
    : (ctx.sourceUrl ?? "content");

  const sourceSection = ctx.sourceText
    ? `\n\nFull source text of ${header}:\n${ctx.sourceText}\n\nSummary:\n${ctx.summary}`
    : `\n\nSummary of ${header}:\n${ctx.summary}`;

  const systemPrompt = `${SYSTEM_PROMPT}${sourceSection}`;
  const messages: Message[] = [];

  for (const msg of ctx.history) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content, timestamp: Date.now() });
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

  messages.push({ role: "user", content: userMessage, timestamp: Date.now() });
  return { systemPrompt, messages: normalizeMessages(messages) };
}

export async function streamWebChatResponse({
  connection,
  modelId,
  webContext,
  userMessage,
  sink,
}: {
  connection: LiteLlmConnection;
  modelId: string;
  webContext: WebChatContext;
  userMessage: string;
  sink: WebChatSink;
}): Promise<{ usedModel: string; responseText: string }> {
  const context = buildWebChatContext(webContext, userMessage);
  const chunks: string[] = [];

  sink.onModel(modelId);

  try {
    const result = await streamTextWithContext({
      modelId,
      connection,
      context,
      timeoutMs: 60_000,
    });

    for await (const chunk of result.textStream) {
      chunks.push(chunk);
      sink.onChunk(chunk);
    }

    sink.onDone();
  } catch (err) {
    sink.onError(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }

  return { usedModel: modelId, responseText: chunks.join("") };
}
