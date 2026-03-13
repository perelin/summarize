import { useCallback, useRef, useState } from "preact/hooks";
import { summarizeSSE, type ApiLength, type SummarizeInsights } from "../lib/api.js";
import { formatDuration } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { StreamingMarkdown } from "./streaming-markdown.js";
import "../styles/markdown.css";

type Phase = "idle" | "streaming" | "done" | "error";

export function SummarizeView() {
  const [mode, setMode] = useState<"url" | "text">("url");
  const [urlValue, setUrlValue] = useState("");
  const [textValue, setTextValue] = useState("");
  const [length, setLength] = useState<ApiLength>("medium");
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("");
  const [chunks, setChunks] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [summaryId, setSummaryId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleSubmit = useCallback(
    (e: Event) => {
      e.preventDefault();

      const body =
        mode === "url"
          ? { url: urlValue.trim(), length }
          : { text: textValue.trim(), length };

      if (mode === "url" && !urlValue.trim()) return;
      if (mode === "text" && !textValue.trim()) return;

      // Reset
      setPhase("streaming");
      setStatusText("Starting\u2026");
      setChunks("");
      setErrorMsg("");
      setSummaryId(null);
      setElapsed(0);
      setCopied(false);

      // Elapsed timer
      const start = Date.now();
      stopTimer();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000));
      }, 1000);

      // Cancel previous
      controllerRef.current?.abort();

      controllerRef.current = summarizeSSE(body, {
        onStatus: (text) => setStatusText(text),
        onChunk: (text) => setChunks((prev) => prev + text),
        onMeta: () => {},
        onDone: (id) => {
          setSummaryId(id);
          setPhase("done");
          stopTimer();
        },
        onError: (message) => {
          setErrorMsg(message);
          setPhase("error");
          stopTimer();
        },
        onMetrics: () => {},
      });
    },
    [mode, urlValue, textValue, length],
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
      <form
        onSubmit={handleSubmit}
        style={{
          border: "1px solid var(--border)",
          borderRadius: "16px",
          background: "var(--panel)",
          padding: "16px",
          display: "grid",
          gap: "12px",
          boxShadow: "var(--shadow-sm)",
          animation: "fadeInUp 600ms var(--ease-out-expo) 80ms both",
        }}
      >
        {/* Tabs */}
        <div style={{ display: "flex", gap: "2px" }} role="tablist">
          <TabButton active={mode === "url"} onClick={() => setMode("url")}>
            URL
          </TabButton>
          <TabButton active={mode === "text"} onClick={() => setMode("text")}>
            Text
          </TabButton>
        </div>

        {mode === "url" ? (
          <input
            type="text"
            value={urlValue}
            onInput={(e) => setUrlValue((e.target as HTMLInputElement).value)}
            placeholder="Paste an article, podcast, or video URL"
            aria-label="URL to summarize"
            autocomplete="off"
            style={{
              width: "100%",
              padding: "10px 14px",
              fontSize: "15px",
              fontFamily: "var(--font-body)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              background: "var(--field-bg)",
              color: "var(--text)",
              outline: "none",
            }}
          />
        ) : (
          <textarea
            value={textValue}
            onInput={(e) => setTextValue((e.target as HTMLTextAreaElement).value)}
            placeholder="Paste content to summarize..."
            aria-label="Text to summarize"
            style={{
              width: "100%",
              padding: "10px 14px",
              fontSize: "15px",
              fontFamily: "var(--font-body)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              background: "var(--field-bg)",
              color: "var(--text)",
              outline: "none",
              minHeight: "120px",
              resize: "vertical",
              lineHeight: "1.55",
            }}
          />
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: "10px", alignItems: "stretch" }}>
          <select
            value={length}
            onChange={(e) => setLength((e.target as HTMLSelectElement).value as ApiLength)}
            aria-label="Summary length"
            style={{
              padding: "10px 14px",
              fontSize: "14px",
              fontFamily: "var(--font-body)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              background: "var(--field-bg)",
              color: "var(--text)",
              outline: "none",
              minWidth: "110px",
              cursor: "pointer",
            }}
          >
            <option value="tiny">Tiny</option>
            <option value="short">Short</option>
            <option value="medium">Medium</option>
            <option value="long">Long</option>
            <option value="xlarge">XLarge</option>
          </select>
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              flex: 1,
              padding: "10px 24px",
              fontSize: "15px",
              fontWeight: "700",
              fontFamily: "var(--font-body)",
              color: "var(--accent-text)",
              background: "var(--accent)",
              border: "none",
              borderRadius: "10px",
              cursor: isSubmitting ? "not-allowed" : "pointer",
              opacity: isSubmitting ? 0.5 : 1,
              letterSpacing: "0.01em",
            }}
          >
            Summarize
          </button>
        </div>
      </form>

      {/* Loading */}
      {phase === "streaming" && (
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
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px", gap: "8px" }}>
            {phase === "done" && summaryId && (
              <button
                type="button"
                onClick={() => navigate(`/summary/${summaryId}`)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "5px 10px",
                  fontFamily: "var(--font-body)",
                  fontSize: "12px",
                  fontWeight: "500",
                  color: "var(--muted)",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  transition: "color 150ms ease, border-color 150ms ease",
                }}
              >
                View details
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
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
          <StreamingMarkdown text={chunks} streaming={phase === "streaming"} />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: preact.ComponentChildren;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        borderRadius: "8px",
        padding: "6px 16px",
        fontSize: "13px",
        fontWeight: active ? "700" : "500",
        fontFamily: "var(--font-body)",
        border: `1px solid ${active ? "var(--border)" : "transparent"}`,
        background: active ? "var(--surface)" : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        cursor: "pointer",
        transition: "color 180ms ease, background 180ms ease, border-color 180ms ease",
        letterSpacing: "0.01em",
      }}
    >
      {children}
    </button>
  );
}
