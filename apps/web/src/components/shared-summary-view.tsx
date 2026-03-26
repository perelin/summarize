import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  type ApiLength,
  type SharedSummaryResponse,
  fetchSharedSummary,
  resummarizeSharedSSE,
} from "../lib/api.js";
import { formatDate } from "../lib/format.js";
import { StreamingMarkdown } from "./streaming-markdown.js";
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
          // Public resummarize is transient — keep the streamed text as display
          // (server does not persist, so re-fetching would revert to original)
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
      <div style={containerStyle}>
        <div style={cardStyle}>
          <Header />
          <div style={{ color: "var(--muted)", padding: "48px 0", textAlign: "center" }}>
            Loading...
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <Header />
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              color: "var(--error-text)",
              fontSize: "15px",
            }}
          >
            {error || "Something went wrong."}
          </div>
          <Footer />
        </div>
      </div>
    );
  }

  const currentApiLength = toApiLength(currentLength ?? data.inputLength);

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <Header />

        {/* Title */}
        {data.title && (
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "26px",
              fontWeight: "700",
              color: "var(--text)",
              margin: "0 0 8px",
              lineHeight: "1.3",
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
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "13px",
              color: "var(--muted)",
              textDecoration: "none",
              marginBottom: "14px",
              wordBreak: "break-all",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" />
              <path d="M10 2h4v4" />
              <path d="M7 9L14 2" />
            </svg>
            {truncateUrl(data.sourceUrl, 60)}
          </a>
        )}

        {/* Metadata badges */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            marginBottom: "16px",
          }}
        >
          <Badge text={data.sourceType} accent />
          <Badge text={data.model} />
          <Badge text={currentLength ?? data.inputLength} />
          {data.metadata.mediaDurationSeconds != null && (
            <Badge text={formatDurationSeconds(data.metadata.mediaDurationSeconds)} />
          )}
          {data.metadata.wordCount != null && (
            <Badge text={`${data.metadata.wordCount.toLocaleString()} words`} />
          )}
          <Badge text={formatDate(data.createdAt)} />
        </div>

        {/* Length switcher */}
        <div
          ref={dropdownRef}
          style={{ position: "relative", display: "inline-block", marginBottom: "16px" }}
        >
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

        {/* Divider */}
        <div
          style={{
            height: "1px",
            background: "var(--border)",
            marginBottom: "20px",
          }}
        />

        {/* Summary */}
        <StreamingMarkdown text={resummarizing ? streamedText : (streamedText || data.summary)} />

        <Footer />
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────

function Header() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: "20px",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "18px",
          fontWeight: "700",
          color: "var(--accent)",
        }}
      >
        Summarize
      </span>
      <span
        style={{
          fontSize: "12px",
          color: "var(--muted)",
          fontFamily: "var(--font-body)",
        }}
      >
        Shared summary
      </span>
    </div>
  );
}

function Footer() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: "32px",
        paddingTop: "16px",
        borderTop: "1px solid var(--border)",
        fontSize: "12px",
        color: "var(--muted)",
        fontFamily: "var(--font-body)",
      }}
    >
      <a
        href="https://summarize.sh"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--muted)", textDecoration: "none" }}
      >
        Created with Summarize
      </a>
      <span style={{ opacity: 0.6 }}>Content is AI-generated</span>
    </div>
  );
}

function Badge({ text, accent }: { text: string; accent?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        fontSize: "11px",
        fontFamily: "var(--font-body)",
        fontWeight: "500",
        color: accent ? "var(--accent)" : "var(--muted)",
        background: accent
          ? "color-mix(in srgb, var(--accent) 10%, transparent)"
          : "var(--surface)",
        border: `1px solid ${accent ? "color-mix(in srgb, var(--accent) 25%, transparent)" : "var(--border)"}`,
        borderRadius: "4px",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

// ── Helpers ──────────────────────────────────────────────

function truncateUrl(url: string, max: number): string {
  if (url.length <= max) return url;
  return url.substring(0, max) + "\u2026";
}

// ── Styles ───────────────────────────────────────────────

const containerStyle: Record<string, string> = {
  minHeight: "100vh",
  display: "flex",
  justifyContent: "center",
  padding: "40px 16px",
  fontFamily: "var(--font-body)",
};

const cardStyle: Record<string, string> = {
  width: "100%",
  maxWidth: "720px",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  boxShadow: "var(--shadow-md)",
  padding: "32px",
};
