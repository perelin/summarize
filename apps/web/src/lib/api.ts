import { getToken } from "./token.js";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Types ────────────────────────────────────────────────

export type ApiLength = "tiny" | "short" | "medium" | "long" | "xlarge";

export type SummarizeInsights = {
  title: string | null;
  siteName: string | null;
  wordCount: number | null;
  characterCount: number | null;
  truncated: boolean;
  mediaDurationSeconds: number | null;
  transcriptSource: string | null;
  transcriptionProvider: string | null;
  cacheStatus: string | null;
  summaryFromCache: boolean;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  extractionMethod: string | null;
  servicesUsed: string[];
  attemptedProviders: string[];
  stages: Array<{ stage: string; durationMs: number }>;
};

export type SummarizeResponse = {
  summaryId: string;
  summary: string;
  metadata: {
    title: string | null;
    source: string;
    model: string;
    usage: { inputTokens: number; outputTokens: number } | null;
    durationMs: number;
  };
  insights: SummarizeInsights | null;
};

export type HistoryEntry = {
  id: string;
  createdAt: string;
  account: string;
  sourceUrl: string | null;
  sourceType: string;
  inputLength: string;
  model: string;
  title: string | null;
  summary: string;
  transcript: string | null;
  mediaPath: string | null;
  mediaSize: number | null;
  mediaType: string | null;
  metadata: string | null;
};

export type HistoryDetailEntry = HistoryEntry & {
  hasTranscript: boolean;
  hasMedia: boolean;
  mediaUrl: string | null;
  transcriptUrl: string | null;
};

export type HistoryListResponse = {
  entries: HistoryEntry[];
  total: number;
  limit: number;
  offset: number;
};

export type AccountInfo = {
  account: { name: string };
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ChatHistoryResponse = {
  summaryId: string;
  messages: ChatMessage[];
};

export type SlidesResponse = {
  ok: boolean;
  sessionId: string;
  sourceId: string;
};

export type SlideInfo = {
  index: number;
  timestamp: number;
  imageUrl: string;
  ocrText: string | null;
  ocrConfidence: number | null;
};

export type SseSlidesData = {
  sourceUrl: string;
  sourceId: string;
  sourceKind: string;
  ocrAvailable: boolean;
  slides: SlideInfo[];
};

// ── SSE event types ──────────────────────────────────────

export type SseInitEvent = { event: "init"; data: { summaryId: string } };
export type SseStatusEvent = { event: "status"; data: { text: string } };
export type SseChunkEvent = { event: "chunk"; data: { text: string } };
export type SseMetaEvent = {
  event: "meta";
  data: { model: string | null; modelLabel: string | null; inputSummary: string | null };
};
export type SseDoneEvent = { event: "done"; data: { summaryId: string } };
export type SseErrorEvent = { event: "error"; data: { message: string; code: string } };
export type SseMetricsEvent = { event: "metrics"; data: Record<string, unknown> };
export type SseSlidesEvent = { event: "slides"; data: SseSlidesData };

export type SseEvent =
  | SseInitEvent
  | SseStatusEvent
  | SseChunkEvent
  | SseMetaEvent
  | SseDoneEvent
  | SseErrorEvent
  | SseMetricsEvent
  | SseSlidesEvent;

// ── API functions ────────────────────────────────────────

export async function fetchMe(): Promise<AccountInfo | null> {
  try {
    const res = await fetch("/v1/me", { headers: authHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as AccountInfo;
  } catch {
    return null;
  }
}

export async function summarizeJson(body: {
  url?: string;
  text?: string;
  length?: ApiLength;
}): Promise<SummarizeResponse> {
  const res = await fetch("/v1/summarize", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as SummarizeResponse;
}

type SseCallbacks = {
  onInit?: (summaryId: string) => void;
  onStatus?: (text: string) => void;
  onChunk?: (text: string) => void;
  onMeta?: (data: SseMetaEvent["data"]) => void;
  onDone?: (summaryId: string) => void;
  onError?: (message: string, code: string) => void;
  onMetrics?: (data: Record<string, unknown>) => void;
};

function parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: SseCallbacks,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  let gotDone = false;
  let gotChunks = false;

  const processLines = (lines: string[]) => {
    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          switch (currentEvent) {
            case "init": callbacks.onInit?.(data.summaryId); break;
            case "status": callbacks.onStatus?.(data.text); break;
            case "chunk": gotChunks = true; callbacks.onChunk?.(data.text); break;
            case "meta": callbacks.onMeta?.(data); break;
            case "done": gotDone = true; callbacks.onDone?.(data.summaryId); break;
            case "error": callbacks.onError?.(data.message, data.code); break;
            case "metrics": callbacks.onMetrics?.(data); break;
          }
        } catch { /* skip malformed data */ }
        currentEvent = "";
      }
    }
  };

  return (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      processLines(lines);
    }
    // Stream closed without done — if we got chunks, treat as complete
    if (!gotDone && gotChunks) {
      callbacks.onDone?.("unknown");
    }
  })();
}

function sseRequest(
  url: string,
  init: RequestInit,
  callbacks: SseCallbacks,
): AbortController {
  const controller = new AbortController();

  fetch(url, { ...init, signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        callbacks.onError?.(
          err?.error?.message ?? `Request failed (${res.status})`,
          err?.error?.code ?? "HTTP_ERROR",
        );
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError?.("No response body", "NO_BODY");
        return;
      }
      await parseSseStream(reader, callbacks);
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        callbacks.onError?.(err.message ?? "Network error", "NETWORK_ERROR");
      }
    });

  return controller;
}

export function summarizeSSE(
  body: { url?: string; text?: string; length?: ApiLength },
  callbacks: SseCallbacks,
): AbortController {
  return sseRequest(
    "/v1/summarize",
    {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    },
    callbacks,
  );
}

/**
 * Upload a file for summarization via multipart/form-data with SSE streaming.
 */
export function summarizeFileSSE(
  file: File,
  options: { length?: ApiLength },
  callbacks: SseCallbacks,
): AbortController {
  const form = new FormData();
  form.append("file", file);
  if (options.length) form.append("length", options.length);

  return sseRequest(
    "/v1/summarize",
    {
      method: "POST",
      headers: { ...authHeaders(), Accept: "text/event-stream" },
      body: form,
    },
    callbacks,
  );
}

/**
 * Connect to an in-progress or completed process via the reconnection endpoint.
 */
export function connectToProcess(
  summaryId: string,
  callbacks: SseCallbacks,
): AbortController {
  return sseRequest(
    `/v1/summarize/${encodeURIComponent(summaryId)}/events`,
    { headers: { ...authHeaders(), Accept: "text/event-stream" } },
    callbacks,
  );
}

export async function fetchHistory(
  limit = 20,
  offset = 0,
): Promise<HistoryListResponse> {
  const res = await fetch(`/v1/history?limit=${limit}&offset=${offset}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load history");
  return (await res.json()) as HistoryListResponse;
}

export async function fetchHistoryDetail(
  id: string,
): Promise<HistoryDetailEntry> {
  const res = await fetch(`/v1/history/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("History entry not found");
  return (await res.json()) as HistoryDetailEntry;
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const res = await fetch(`/v1/history/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete entry");
}

export async function triggerSlides(summaryId: string): Promise<SlidesResponse> {
  const res = await fetch(`/v1/summarize/${encodeURIComponent(summaryId)}/slides`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message ?? "Failed to trigger slide extraction");
  }
  return (await res.json()) as SlidesResponse;
}

export function streamSlidesEvents(
  summaryId: string,
  sessionId: string,
  callbacks: {
    onStatus?: (text: string) => void;
    onSlides?: (data: SseSlidesData) => void;
    onDone?: () => void;
    onError?: (message: string) => void;
  },
): AbortController {
  const controller = new AbortController();
  const token = getToken();

  fetch(
    `/v1/summarize/${encodeURIComponent(summaryId)}/slides/events?sessionId=${encodeURIComponent(sessionId)}`,
    {
      headers: { ...authHeaders() },
      signal: controller.signal,
    },
  )
    .then(async (res) => {
      if (!res.ok) {
        callbacks.onError?.("Failed to connect to slide events");
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      // Poll for new events since the background extraction may not be done yet
      const poll = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                switch (currentEvent) {
                  case "status":
                    callbacks.onStatus?.(data.text);
                    break;
                  case "slides":
                    callbacks.onSlides?.(data);
                    break;
                  case "done":
                    callbacks.onDone?.();
                    return;
                  case "error":
                    callbacks.onError?.(data.message);
                    return;
                }
              } catch {
                // skip
              }
              currentEvent = "";
            }
          }
        }
      };

      await poll();
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        callbacks.onError?.(err.message ?? "Network error");
      }
    });

  return controller;
}

export function streamChat(
  body: { summaryId: string; message: string },
  callbacks: {
    onChunk?: (text: string) => void;
    onDone?: () => void;
    onError?: (message: string) => void;
  },
): AbortController {
  const controller = new AbortController();

  fetch("/v1/chat", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        callbacks.onError?.(err?.error?.message ?? "Chat request failed");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (currentEvent) {
                case "chunk":
                  callbacks.onChunk?.(data.text);
                  break;
                case "done":
                  callbacks.onDone?.();
                  return;
                case "error":
                  callbacks.onError?.(data.message);
                  return;
              }
            } catch {
              // skip
            }
            currentEvent = "";
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        callbacks.onError?.(err.message ?? "Network error");
      }
    });

  return controller;
}

export async function fetchChatHistory(
  summaryId: string,
): Promise<ChatHistoryResponse> {
  const res = await fetch(
    `/v1/chat/history?summaryId=${encodeURIComponent(summaryId)}`,
    { headers: authHeaders() },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message ?? "Failed to load chat history");
  }
  return (await res.json()) as ChatHistoryResponse;
}
