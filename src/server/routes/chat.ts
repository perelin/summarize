import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SseEvent } from "@steipete/summarize_p2-core/sse";
import type { ChatStore } from "../../chat-store.js";
import type { SummarizeConfig } from "../../config.js";
import type { HistoryStore } from "../../history.js";
import {
  streamWebChatResponse,
  type WebChatContext,
} from "../../summarize/chat.js";
import type { SseSessionManager } from "../sse-session.js";

export type ChatRouteDeps = {
  env: Record<string, string | undefined>;
  config: SummarizeConfig | null;
  historyStore: HistoryStore;
  chatStore: ChatStore;
  sseSessionManager: SseSessionManager;
};

type Variables = { account: string };

type ChatJsonBody = {
  summaryId: string;
  message: string;
  model?: string;
};

function jsonError(code: string, message: string) {
  return { error: { code, message } };
}

export function createChatRoute(deps: ChatRouteDeps): Hono<{ Variables: Variables }> {
  const route = new Hono<{ Variables: Variables }>();

  // ---- POST /chat — send a chat message and receive streamed response ----
  route.post("/chat", async (c) => {
    const account = c.get("account") as string;

    let body: ChatJsonBody;
    try {
      body = (await c.req.json()) as ChatJsonBody;
    } catch {
      return c.json(jsonError("INVALID_INPUT", "Invalid JSON body"), 400);
    }

    if (!body.summaryId || typeof body.summaryId !== "string") {
      return c.json(jsonError("INVALID_INPUT", "summaryId is required"), 400);
    }
    if (!body.message || typeof body.message !== "string") {
      return c.json(jsonError("INVALID_INPUT", "message is required"), 400);
    }
    if (body.message.trim().length === 0) {
      return c.json(jsonError("INVALID_INPUT", "message must not be empty"), 400);
    }

    // Load summary from history
    const entry = deps.historyStore.getById(body.summaryId, account);
    if (!entry) {
      return c.json(jsonError("NOT_FOUND", "Summary not found"), 404);
    }

    // Load prior chat messages
    const priorMessages = deps.chatStore.listBySummaryId(body.summaryId, account);

    const webContext: WebChatContext = {
      summaryId: body.summaryId,
      summary: entry.summary,
      sourceText: entry.transcript ?? undefined,
      sourceUrl: entry.sourceUrl ?? undefined,
      sourceTitle: entry.title ?? undefined,
      history: priorMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    const modelOverride = body.model ?? deps.env.SUMMARIZE_DEFAULT_MODEL ?? null;
    const sessionId = deps.sseSessionManager.createSession();
    let eventCounter = 0;

    const pushAndBuffer = (event: SseEvent): number => {
      eventCounter++;
      deps.sseSessionManager.pushEvent(sessionId, event);
      return eventCounter;
    };

    const userMessage = body.message.trim();

    console.log(
      `[summarize-api] [${account}] chat request: summaryId=${body.summaryId} historyLength=${priorMessages.length}${modelOverride ? ` model=${modelOverride}` : ""}`,
    );

    // Save user message immediately
    const userMsgId = randomUUID();
    deps.chatStore.insert({
      id: userMsgId,
      summaryId: body.summaryId,
      account,
      role: "user",
      content: userMessage,
      model: null,
      createdAt: new Date().toISOString(),
    });

    return streamSSE(c, async (stream) => {
      try {
        const chunks: string[] = [];
        let usedModel = "unknown";

        const result = await streamWebChatResponse({
          env: deps.env,
          fetchImpl: fetch,
          config: deps.config,
          webContext,
          userMessage,
          modelOverride,
          sink: {
            onChunk: (text) => {
              chunks.push(text);
              const evt: SseEvent = { event: "chunk", data: { text } };
              const id = pushAndBuffer(evt);
              void stream.writeSSE({
                event: "chunk",
                data: JSON.stringify(evt.data),
                id: String(id),
              });
            },
            onModel: (model) => {
              usedModel = model;
              const evt: SseEvent = {
                event: "meta",
                data: {
                  model,
                  modelLabel: model,
                  inputSummary: null,
                },
              };
              const id = pushAndBuffer(evt);
              void stream.writeSSE({
                event: "meta",
                data: JSON.stringify(evt.data),
                id: String(id),
              });
            },
            onDone: () => {
              // handled below after saving
            },
            onError: (_err) => {
              // handled in catch below
            },
          },
        });

        // Save assistant response
        const assistantMsgId = randomUUID();
        deps.chatStore.insert({
          id: assistantMsgId,
          summaryId: body.summaryId,
          account,
          role: "assistant",
          content: result.responseText,
          model: result.usedModel,
          createdAt: new Date().toISOString(),
        });

        // Emit done event
        const doneEvt: SseEvent = {
          event: "done",
          data: { summaryId: body.summaryId },
        };
        const doneId = pushAndBuffer(doneEvt);
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify(doneEvt.data),
          id: String(doneId),
        });

        console.log(
          `[summarize-api] chat complete: summaryId=${body.summaryId} model=${usedModel}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Chat request failed";
        console.error(`[summarize-api] chat error: summaryId=${body.summaryId}`, err);

        const errorEvt: SseEvent = {
          event: "error",
          data: { message, code: "CHAT_ERROR" },
        };
        const errorId = pushAndBuffer(errorEvt);
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify(errorEvt.data),
          id: String(errorId),
        });
      }
    });
  });

  // ---- GET /chat/:id/events — SSE reconnection for a chat response ----
  route.get("/chat/:id/events", async (c) => {
    const sessionId = c.req.param("id");

    const session = deps.sseSessionManager.getSession(sessionId);
    if (!session) {
      return c.json(jsonError("NOT_FOUND", "Session not found or expired"), 404);
    }

    const lastEventIdHeader = c.req.header("last-event-id");
    const afterEventId = lastEventIdHeader
      ? parseInt(lastEventIdHeader, 10)
      : 0;
    const events = deps.sseSessionManager.getEvents(
      sessionId,
      Number.isNaN(afterEventId) ? 0 : afterEventId,
    );

    return streamSSE(c, async (stream) => {
      for (const { id, event } of events) {
        await stream.writeSSE({
          event: event.event,
          data: JSON.stringify(event.data),
          id: String(id),
        });
      }
    });
  });

  // ---- GET /chat/history?summaryId=X — list chat messages for a summary ----
  route.get("/chat/history", (c) => {
    const account = c.get("account") as string;
    const summaryId = c.req.query("summaryId");

    if (!summaryId) {
      return c.json(jsonError("INVALID_INPUT", "summaryId query parameter is required"), 400);
    }

    // Verify the summary exists and belongs to this account
    const entry = deps.historyStore.getById(summaryId, account);
    if (!entry) {
      return c.json(jsonError("NOT_FOUND", "Summary not found"), 404);
    }

    const messages = deps.chatStore.listBySummaryId(summaryId, account);

    return c.json({
      summaryId,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
  });

  return route;
}
