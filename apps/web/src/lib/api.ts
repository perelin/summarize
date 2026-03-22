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
  pipelineStages?: Array<{ id: string; status: string; elapsedMs?: number | null }>;
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
  audioPath: string | null;
  audioSize: number | null;
  audioType: string | null;
  metadata: string | null;
};

export type HistoryDetailEntry = HistoryEntry & {
  hasTranscript: boolean;
  hasMedia: boolean;
  hasAudio: boolean;
  mediaUrl: string | null;
  audioUrl: string | null;
  transcriptUrl: string | null;
};

export type HistoryListItem = Omit<HistoryEntry, "transcript"> & {
  hasTranscript: boolean;
  hasMedia: boolean;
  hasAudio: boolean;
};

export type HistoryListResponse = {
  entries: HistoryListItem[];
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

export async function fetchDefaultToken(): Promise<string | null> {
  try {
    const res = await fetch("/v1/default-token");
    if (!res.ok) return null;
    const data = (await res.json()) as { token: string; account: string };
    return data.token;
  } catch {
    return null;
  }
}

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

/** Open-ended step identifier — derived from progress event kinds. */
export type UiStageId = string;
export type UiStageStatus = "pending" | "active" | "done" | "not-needed" | "error";

export type StageEvent = {
  stage: UiStageId;
  status: UiStageStatus;
  detail?: string | null;
  elapsedMs?: number | null;
};

type SseCallbacks = {
  onInit?: (summaryId: string) => void;
  onStatus?: (text: string) => void;
  onStage?: (data: StageEvent) => void;
  onChunk?: (text: string) => void;
  onMeta?: (data: SseMetaEvent["data"]) => void;
  onDone?: (summaryId: string) => void;
  onError?: (message: string, code: string) => void;
  onMetrics?: (data: Record<string, unknown>) => void;
};

/** Return "stop" from a handler to terminate the SSE read loop early. */
type SseEventHandler = (data: any) => void | "stop";

/**
 * Low-level SSE byte-stream parser. Dispatches parsed events through
 * a name-to-handler map. If a handler returns "stop", reading ceases.
 */
async function parseSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handlers: Record<string, SseEventHandler>,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    let currentEvent = "";
    let shouldStop = false;
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (handlers[currentEvent]?.(data) === "stop") {
            shouldStop = true;
            break;
          }
        } catch {
          /* skip malformed data */
        }
        currentEvent = "";
      }
    }
    if (shouldStop) break;
  }
}

function parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: SseCallbacks,
): Promise<void> {
  let gotDone = false;
  let gotChunks = false;
  return parseSseEvents(reader, {
    init: (data) => callbacks.onInit?.(data.summaryId),
    status: (data) => callbacks.onStatus?.(data.text),
    stage: (data) => callbacks.onStage?.(data as StageEvent),
    chunk: (data) => {
      gotChunks = true;
      callbacks.onChunk?.(data.text);
    },
    meta: (data) => callbacks.onMeta?.(data),
    done: (data) => {
      gotDone = true;
      callbacks.onDone?.(data.summaryId);
    },
    error: (data) => callbacks.onError?.(data.message, data.code),
    metrics: (data) => callbacks.onMetrics?.(data),
  }).then(() => {
    if (!gotDone && gotChunks) callbacks.onDone?.("unknown");
  });
}

function sseRequest(url: string, init: RequestInit, callbacks: SseCallbacks): AbortController {
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
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
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
export function connectToProcess(summaryId: string, callbacks: SseCallbacks): AbortController {
  return sseRequest(
    `/v1/summarize/${encodeURIComponent(summaryId)}/events`,
    { headers: { ...authHeaders(), Accept: "text/event-stream" } },
    callbacks,
  );
}

export async function fetchHistory(limit = 20, offset = 0): Promise<HistoryListResponse> {
  const res = await fetch(`/v1/history?limit=${limit}&offset=${offset}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load history");
  return (await res.json()) as HistoryListResponse;
}

export async function fetchHistoryDetail(id: string): Promise<HistoryDetailEntry> {
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

      await parseSseEvents(reader, {
        status: (data) => callbacks.onStatus?.(data.text),
        slides: (data) => callbacks.onSlides?.(data),
        done: () => {
          callbacks.onDone?.();
          return "stop";
        },
        error: (data) => {
          callbacks.onError?.(data.message);
          return "stop";
        },
      });
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

      await parseSseEvents(reader, {
        chunk: (data) => callbacks.onChunk?.(data.text),
        done: () => {
          callbacks.onDone?.();
          return "stop";
        },
        error: (data) => {
          callbacks.onError?.(data.message);
          return "stop";
        },
      });
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        callbacks.onError?.(err.message ?? "Network error");
      }
    });

  return controller;
}

export async function fetchChatHistory(summaryId: string): Promise<ChatHistoryResponse> {
  const res = await fetch(`/v1/chat/history?summaryId=${encodeURIComponent(summaryId)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message ?? "Failed to load chat history");
  }
  return (await res.json()) as ChatHistoryResponse;
}
