import { useEffect, useRef, useState } from "preact/hooks";
import { connectToProcess, fetchHistoryDetail, type HistoryDetailEntry } from "../lib/api.js";
import { ChatPanel } from "./chat-panel.js";
import { NotFoundView } from "./not-found-view.js";
import { StreamingMarkdown } from "./streaming-markdown.js";
import { SummaryDetail } from "./summary-detail.js";
import "../styles/markdown.css";

type Phase = "loading" | "streaming" | "done" | "not-found";

export function ProcessView({ id }: { id: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [chunks, setChunks] = useState("");
  const [statusText, setStatusText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [historyEntry, setHistoryEntry] = useState<HistoryDetailEntry | null>(null);
  const [copied, setCopied] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    // Reset state on ID change
    setPhase("loading");
    setChunks("");
    setStatusText("");
    setElapsed(0);
    setHistoryEntry(null);
    controllerRef.current?.abort();
    stopTimer();

    // Start elapsed timer
    const start = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    // Try connecting to active SSE session
    controllerRef.current = connectToProcess(id, {
      onStatus: (text) => {
        setPhase("streaming");
        setStatusText(text);
      },
      onChunk: (text) => {
        setPhase("streaming");
        setChunks((prev) => prev + text);
      },
      onMeta: () => {},
      onDone: () => {
        setPhase("done");
        stopTimer();
        // Load the full history entry for metadata, media, etc.
        fetchHistoryDetail(id)
          .then(setHistoryEntry)
          .catch(() => {}); // summary just completed, detail may take a moment
      },
      onError: (_message, code) => {
        if (code === "NOT_FOUND") {
          // Session expired or never existed — try loading from history
          stopTimer();
          fetchHistoryDetail(id)
            .then((entry) => {
              setHistoryEntry(entry);
              setPhase("done");
            })
            .catch(() => {
              setPhase("not-found");
            });
        }
      },
      onMetrics: () => {},
    });

    return () => {
      controllerRef.current?.abort();
      stopTimer();
    };
  }, [id]);

  // Loading skeleton
  if (phase === "loading") {
    return (
      <div style={{ padding: "24px 0", color: "var(--muted)", fontSize: "14px" }}>
        Connecting...
      </div>
    );
  }

  // Not found
  if (phase === "not-found") {
    return <NotFoundView />;
  }

  // Completed — delegate to SummaryDetail for full metadata/media/chat experience
  if (phase === "done" && historyEntry) {
    return <SummaryDetail id={id} />;
  }

  // Streaming or just completed (waiting for history entry to load)
  return (
    <div>
      {/* Progress bar */}
      {phase === "streaming" && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}
        >
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

      {/* Streamed content */}
      {chunks && (
        <div style={{ animation: "fadeInUp 500ms var(--ease-out-expo)" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  await navigator.clipboard.writeText(chunks);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })();
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

      {/* Chat — available once done but before history entry loads */}
      {phase === "done" && <ChatPanel summaryId={id} />}
    </div>
  );
}
