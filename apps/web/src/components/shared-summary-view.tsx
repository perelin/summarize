import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  type ApiLength,
  type SharedSummaryResponse,
  fetchSharedSummary,
  resummarizeSharedSSE,
} from "../lib/api.js";
import { formatDate, truncateUrl } from "../lib/format.js";
import { StreamingMarkdown } from "./streaming-markdown.js";
import { ThemeToggle } from "./theme-toggle.js";
import "../styles/markdown.css";

type LengthOption = {
  key: ApiLength;
  label: string;
  chars: string;
};

const LENGTH_OPTIONS: LengthOption[] = [
  { key: "short", label: "Short", chars: "~800" },
  { key: "medium", label: "Medium", chars: "~1.8k" },
  { key: "long", label: "Long", chars: "~4k" },
  { key: "xlarge", label: "XL", chars: "~10k" },
];

/** Map internal length to display label. */
function toDisplayLabel(inputLength: string): string {
  switch (inputLength) {
    case "short":
      return "Short";
    case "medium":
      return "Medium";
    case "long":
      return "Long";
    case "xl":
      return "XL";
    case "xxl":
      return "XXL";
    default:
      return inputLength;
  }
}

/** Map internal length to ApiLength key. */
function toApiLength(inputLength: string): ApiLength | null {
  switch (inputLength) {
    case "short":
      return "short";
    case "medium":
      return "medium";
    case "long":
      return "long";
    case "xl":
    case "xxl":
      return "xlarge";
    default:
      return null;
  }
}

function formatDurationSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function SharedSummaryView({ token }: { token: string }) {
  const [data, setData] = useState<SharedSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Resummarize state
  const [resummarizing, setResummarizing] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [resummarizeError, setResummarizeError] = useState<string | null>(null);
  const [currentLength, setCurrentLength] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [align, setAlign] = useState<"left" | "right">("right");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    fetchSharedSummary(token)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [token]);

  // Dropdown alignment
  useLayoutEffect(() => {
    if (!dropdownOpen || !dropdownRef.current) return;
    const rect = dropdownRef.current.getBoundingClientRect();
    setAlign(rect.right > window.innerWidth - 8 ? "right" : "left");
  }, [dropdownOpen]);

  // Close dropdown on outside click / escape
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [dropdownOpen]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleLengthSelect = (option: LengthOption) => {
    if (!data || resummarizing) return;
    const currentApiLength = toApiLength(currentLength ?? data.inputLength);
    if (option.key === currentApiLength) return;
    setDropdownOpen(false);
    setResummarizing(true);
    setStreamedText("");
    setResummarizeError(null);

    abortRef.current = resummarizeSharedSSE(
      token,
      { length: option.key },
      {
        onChunk: (text) => setStreamedText((prev) => prev + text),
        onDone: () => {
          setResummarizing(false);
          setCurrentLength(option.key === "xlarge" ? "xl" : option.key);
        },
        onError: (message) => {
          setResummarizing(false);
          setResummarizeError(message);
        },
      },
    );
  };

  if (loading) {
    return (
      <div class="container">
        <SharedHeader />
        <div style={{ color: "var(--muted)", padding: "48px 0", textAlign: "center" }}>
          Loading\u2026
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div class="container">
        <SharedHeader />
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            background: "var(--error-bg)",
            border: "1px solid var(--error-border)",
            borderRadius: "10px",
            color: "var(--error-text)",
            fontSize: "14px",
            lineHeight: "1.45",
          }}
        >
          {error || "Something went wrong."}
        </div>
      </div>
    );
  }

  const currentApiLength = toApiLength(currentLength ?? data.inputLength);

  return (
    <div class="container">
      <SharedHeader />

      {/* Title */}
      {data.title && (
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontWeight: "400",
            fontSize: "1.6rem",
            lineHeight: "1.25",
            color: "var(--text)",
            margin: "0 0 6px",
          }}
        >
          {data.title}
        </h2>
      )}

      {/* Source link */}
      {data.sourceUrl && (
        <a
          href={data.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            fontSize: "12px",
            fontFamily: "var(--font-mono)",
            color: "var(--muted)",
            textDecoration: "none",
            marginBottom: "16px",
            wordBreak: "break-all",
            borderBottom: "1px dotted currentColor",
          }}
        >
          {truncateUrl(data.sourceUrl, 60)}
        </a>
      )}

      {/* Action bar: length switcher */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "6px",
          flexWrap: "wrap",
          marginBottom: "16px",
        }}
      >
        <div ref={dropdownRef} style={{ position: "relative", marginLeft: "auto" }}>
          <button
            type="button"
            onClick={() => !resummarizing && setDropdownOpen(!dropdownOpen)}
            disabled={resummarizing}
            style={{
              padding: "5px 12px",
              fontSize: "12px",
              fontWeight: "600",
              fontFamily: "var(--font-body)",
              color: resummarizing ? "var(--muted)" : "var(--text)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: resummarizing ? "wait" : "pointer",
              transition: "all 180ms ease",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              whiteSpace: "nowrap",
            }}
          >
            {resummarizing ? (
              <>
                <span
                  style={{
                    display: "inline-block",
                    width: "10px",
                    height: "10px",
                    border: "2px solid var(--border-strong)",
                    borderTopColor: "var(--accent)",
                    borderRadius: "50%",
                    animation: "spin 600ms linear infinite",
                  }}
                />
                {" Resummarizing\u2026"}
              </>
            ) : (
              <>
                {"\u2195 "}
                {toDisplayLabel(currentLength ?? data.inputLength)}
                {" \u25BE"}
              </>
            )}
          </button>

          {dropdownOpen && !resummarizing && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                ...(align === "right" ? { right: 0 } : { left: 0 }),
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                boxShadow: "var(--shadow-md)",
                padding: "4px",
                zIndex: 5,
                minWidth: "160px",
                animation: "fadeIn 100ms ease",
              }}
            >
              {LENGTH_OPTIONS.map((option) => {
                const isCurrent = option.key === currentApiLength;
                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={isCurrent}
                    onClick={() => handleLengthSelect(option)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      width: "100%",
                      padding: "6px 10px",
                      fontSize: "13px",
                      fontFamily: "var(--font-body)",
                      color: isCurrent ? "var(--accent)" : "var(--text)",
                      background: isCurrent
                        ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                        : "transparent",
                      border: "none",
                      borderRadius: "6px",
                      cursor: isCurrent ? "default" : "pointer",
                      textAlign: "left" as const,
                      transition: "background 100ms ease",
                    }}
                  >
                    <span>
                      {option.label}
                      {isCurrent && (
                        <span style={{ marginLeft: "6px", fontSize: "11px", opacity: 0.7 }}>
                          current
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--muted)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {option.chars}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>

      {/* Resummarize error */}
      {resummarizeError && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: "12px",
            fontSize: "13px",
            color: "var(--error-text)",
            background: "var(--danger-bg)",
            border: "1px solid var(--danger-border)",
            borderRadius: "8px",
          }}
        >
          {resummarizeError}
        </div>
      )}

      {/* Summary */}
      <StreamingMarkdown text={resummarizing ? streamedText : streamedText || data.summary} />

      {/* Metadata */}
      <SharedMetaBar data={data} currentLength={currentLength} />

      {/* Footer */}
      <footer
        class="colophon"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <a href="https://summarize.sh" target="_blank" rel="noopener noreferrer">
          Summarize_p2
        </a>
        <span style={{ opacity: 0.6 }}>Content is AI-generated</span>
      </footer>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────

function SharedHeader() {
  return (
    <header class="brand">
      <div class="brand-header">
        <div>
          <h1 class="brand-title">
            <a href="/" style={{ color: "inherit", textDecoration: "none" }}>
              Summarize_p2
            </a>
          </h1>
          <p class="brand-tagline">Shared summary</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function SharedMetaBar({
  data,
  currentLength,
}: {
  data: SharedSummaryResponse;
  currentLength: string | null;
}) {
  const parts: preact.ComponentChildren[] = [];

  parts.push(<span>{data.sourceType}</span>);
  parts.push(<span>{data.model}</span>);
  parts.push(<span>{currentLength ?? data.inputLength}</span>);
  if (data.metadata.mediaDurationSeconds != null) {
    parts.push(<span>{formatDurationSeconds(data.metadata.mediaDurationSeconds)}</span>);
  }
  if (data.metadata.wordCount != null) {
    parts.push(<span>{data.metadata.wordCount.toLocaleString()} words</span>);
  }
  parts.push(<span>{formatDate(data.createdAt)}</span>);

  return (
    <div
      style={{
        marginTop: "12px",
        padding: "0 4px",
        fontSize: "12px",
        fontFamily: "var(--font-mono)",
        color: "var(--muted)",
        display: "flex",
        flexWrap: "wrap",
        gap: "4px 14px",
        opacity: 0.75,
      }}
    >
      {parts.map((part, i) => (
        <span key={i}>{part}</span>
      ))}
    </div>
  );
}
