import { useCallback, useRef, useState } from "preact/hooks";
import {
  summarizeSSE,
  summarizeFileSSE,
  type ApiLength,
  type StageEvent,
  type UiStageId,
} from "../lib/api.js";
import { navigate } from "../lib/router.js";
import { ChatPanel } from "./chat-panel.js";
import { StageTracker, type StageState } from "./stage-tracker.js";
import { StreamingMarkdown } from "./streaming-markdown.js";
import { UnifiedInput, type SubmitPayload } from "./unified-input.js";
import "../styles/markdown.css";

type Phase = "idle" | "streaming" | "done" | "error";

const INITIAL_STAGES: Record<UiStageId, StageState> = {
  fetch: { status: "pending" },
  extract: { status: "pending" },
  transcribe: { status: "pending" },
  summarize: { status: "pending" },
};

export function SummarizeView() {
  const [length, setLength] = useState<ApiLength>("medium");
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("");
  const [chunks, setChunks] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [summaryId, setSummaryId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const [stages, setStages] = useState<Record<UiStageId, StageState>>({ ...INITIAL_STAGES });
  const [hasStages, setHasStages] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const sseCallbacks = {
    onInit: (id: string) => {
      setSummaryId(id);
      navigate(`/s/${id}`);
    },
    onStatus: (text: string) => setStatusText(text),
    onStage: (data: StageEvent) => {
      setHasStages(true);
      setStages((prev) => ({
        ...prev,
        [data.stage]: {
          status: data.status,
          detail: data.detail ?? prev[data.stage]?.detail ?? null,
          elapsedMs: data.elapsedMs ?? prev[data.stage]?.elapsedMs ?? null,
        },
      }));
    },
    onChunk: (text: string) => setChunks((prev) => prev + text),
    onMeta: () => {},
    onDone: (id: string) => {
      setSummaryId(id);
      setPhase("done");
      stopTimer();
    },
    onError: (message: string) => {
      setErrorMsg(message);
      setPhase("error");
      stopTimer();
    },
    onMetrics: () => {},
  };

  const handleSubmit = useCallback(
    (payload: SubmitPayload) => {
      // Reset
      setPhase("streaming");
      setStatusText("Starting\u2026");
      setChunks("");
      setErrorMsg("");
      setSummaryId(null);
      setElapsed(0);
      setCopied(false);
      setStages({ ...INITIAL_STAGES });
      setHasStages(false);

      // Elapsed timer
      const start = Date.now();
      stopTimer();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000));
      }, 1000);

      // Cancel previous
      controllerRef.current?.abort();

      if (payload.mode === "file") {
        controllerRef.current = summarizeFileSSE(payload.file, { length }, sseCallbacks);
      } else if (payload.mode === "url") {
        controllerRef.current = summarizeSSE({ url: payload.url, length }, sseCallbacks);
      } else {
        controllerRef.current = summarizeSSE({ text: payload.text, length }, sseCallbacks);
      }
    },
    [length],
  );

  const handleCopy = async () => {
    if (!chunks) return;
    await navigator.clipboard.writeText(chunks);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isSubmitting = phase === "streaming";

  return (
    <div>
      <UnifiedInput
        onSubmit={handleSubmit}
        disabled={isSubmitting}
        length={length}
        onLengthChange={setLength}
      />

      {/* Stage tracker */}
      {(phase === "streaming" || phase === "done") && hasStages && (
        <div style={{ marginTop: "24px" }}>
          <StageTracker stages={stages} done={phase === "done"} elapsed={elapsed} />
        </div>
      )}

      {/* Fallback loading (if no stage events received yet) */}
      {phase === "streaming" && !hasStages && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "24px" }}>
          <div
            style={{
              width: "100%",
              height: "2px",
              background: "var(--border)",
              borderRadius: "1px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "30%",
                height: "100%",
                background: "var(--accent)",
                borderRadius: "1px",
                animation: "loadingSlide 1.6s var(--ease-out-quart) infinite",
              }}
            />
          </div>
          <span style={{ fontSize: "13px", color: "var(--muted)", letterSpacing: "0.01em" }}>
            {statusText || "Summarizing\u2026"} ({elapsed}s)
          </span>
        </div>
      )}

      {/* Error */}
      {phase === "error" && (
        <div
          role="alert"
          style={{
            marginTop: "24px",
            padding: "12px 14px",
            background: "var(--error-bg)",
            border: "1px solid var(--error-border)",
            borderRadius: "10px",
            color: "var(--error-text)",
            fontSize: "14px",
            lineHeight: "1.45",
            animation: "fadeIn 300ms var(--ease-out-expo)",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Result */}
      {(phase === "streaming" || phase === "done") && chunks && (
        <div style={{ marginTop: "32px", animation: "fadeInUp 500ms var(--ease-out-expo)" }}>
          <div
            style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px", gap: "8px" }}
          >
            <button
              type="button"
              onClick={() => {
                void handleCopy();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 10px",
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                fontWeight: "500",
                color: copied ? "var(--accent)" : "var(--muted)",
                background: "transparent",
                border: `1px solid ${copied ? "color-mix(in srgb, var(--accent) 30%, transparent)" : "var(--border)"}`,
                borderRadius: "6px",
                cursor: "pointer",
                transition: "color 150ms ease, border-color 150ms ease",
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <StreamingMarkdown text={chunks} />
        </div>
      )}

      {/* Chat — available once summary is complete */}
      {phase === "done" && summaryId && <ChatPanel summaryId={summaryId} />}
    </div>
  );
}
