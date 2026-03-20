import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { HistoryDetailEntry } from "../lib/api.js";
import { extractDisplayTitle } from "../lib/display-title.js";
import { getSettings } from "../lib/settings.js";

type ContentOption = "summary" | "transcript" | "both";

type AiTarget = {
  name: string;
  url: string | null;
  color: string;
};

function getAiTargets(): AiTarget[] {
  const settings = getSettings();
  return [
    { name: "Claude", url: "https://claude.ai/new", color: "#d97706" },
    { name: "ChatGPT", url: "https://chatgpt.com", color: "#059669" },
    { name: "Gemini", url: "https://gemini.google.com", color: "#2563eb" },
    { name: "OpenWebUI", url: settings.openWebUiUrl, color: "#7c3aed" },
  ];
}

function buildClipboardContent(
  entry: HistoryDetailEntry,
  option: ContentOption,
  title: string,
): string {
  const sourceId = entry.sourceUrl ?? `uploaded ${entry.sourceType || "file"}`;
  const parts: string[] = [
    "I used Summarize to process this content and would like to discuss it with you.",
    "",
  ];

  if (option === "summary" || option === "both") {
    parts.push("## Summary", "", entry.summary || "", "");
  }

  if (option === "transcript" || option === "both") {
    parts.push(
      `Here is the original source transcript. Source was ${title} (${sourceId}).`,
      "",
      "## Transcript",
      "",
      entry.transcript || "",
    );
  }

  if (option === "summary") {
    parts.push(`Source: ${title} (${sourceId})`);
  }

  return parts.join("\n");
}

const CONTENT_OPTIONS: { key: ContentOption; label: string }[] = [
  { key: "summary", label: "Copy summary" },
  { key: "transcript", label: "Copy transcript" },
  { key: "both", label: "Copy both" },
];

export function DiscussIn({ entry }: { entry: HistoryDetailEntry }) {
  const [openDropdown, setOpenDropdown] = useState<"copy" | "openin" | null>(null);
  const [showCopyFeedback, setShowCopyFeedback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const openInRef = useRef<HTMLDivElement>(null);
  const title = extractDisplayTitle(entry);
  const hasSummary = Boolean(entry.summary);
  const hasTranscript = Boolean(entry.hasTranscript && entry.transcript);

  const [copyAlign, setCopyAlign] = useState<"left" | "right">("left");
  const [openInAlign, setOpenInAlign] = useState<"left" | "right">("left");

  useLayoutEffect(() => {
    if (!openDropdown) return;
    const activeRef = openDropdown === "copy" ? copyRef : openInRef;
    const setAlign = openDropdown === "copy" ? setCopyAlign : setOpenInAlign;
    if (!activeRef.current) return;
    const rect = activeRef.current.getBoundingClientRect();
    setAlign(rect.right > window.innerWidth - 8 ? "right" : "left");
  }, [openDropdown]);

  useEffect(() => {
    if (!openDropdown) return;
    const handleClick = (e: MouseEvent) => {
      const activeRef = openDropdown === "copy" ? copyRef : openInRef;
      if (activeRef.current && !activeRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenDropdown(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openDropdown]);

  const handleCopy = async (option: ContentOption) => {
    setOpenDropdown(null);
    setError(null);
    try {
      const content = buildClipboardContent(entry, option, title);
      await navigator.clipboard.writeText(content);
      setShowCopyFeedback(true);
      setTimeout(() => setShowCopyFeedback(false), 1000);
    } catch {
      setError("Clipboard access denied");
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleOpenService = (target: AiTarget) => {
    setOpenDropdown(null);
    if (!target.url) {
      window.dispatchEvent(new CustomEvent("open-settings"));
      return;
    }
    window.open(target.url, "_blank", "noopener");
  };

  const targets = getAiTargets();

  return (
    <div style={{ marginTop: "18px" }}>
      {/* Segmented button group */}
      <div style={{ display: "inline-flex", borderRadius: "6px", overflow: "hidden" }}>
        {/* Copy button + dropdown wrapper */}
        <div ref={copyRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setOpenDropdown(openDropdown === "copy" ? null : "copy")}
            style={{
              padding: "5px 12px",
              fontSize: "12px",
              fontWeight: "600",
              fontFamily: "var(--font-body)",
              color: showCopyFeedback ? "#34d399" : "#60a5fa",
              background: showCopyFeedback ? "rgba(52, 211, 153, 0.15)" : "rgba(96, 165, 250, 0.1)",
              border: `1px solid ${showCopyFeedback ? "rgba(52, 211, 153, 0.25)" : "rgba(96, 165, 250, 0.25)"}`,
              borderRight: "none",
              borderRadius: "6px 0 0 6px",
              cursor: "pointer",
              transition: "all 180ms ease",
            }}
          >
            {showCopyFeedback ? "\u2713 Copied \u25BE" : "Copy\u2026 \u25BE"}
          </button>

          {/* Copy dropdown */}
          {openDropdown === "copy" && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                ...(copyAlign === "right" ? { right: 0 } : { left: 0 }),
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                boxShadow: "var(--shadow-md)",
                padding: "4px",
                zIndex: 5,
                minWidth: "150px",
                animation: "fadeIn 100ms ease",
              }}
            >
              {CONTENT_OPTIONS.map(({ key, label }) => {
                const disabled =
                  (key === "summary" && !hasSummary) ||
                  (key === "transcript" && !hasTranscript) ||
                  (key === "both" && (!hasSummary || !hasTranscript));
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled) void handleCopy(key);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "6px 10px",
                      fontSize: "13px",
                      fontFamily: "var(--font-body)",
                      color: disabled ? "var(--muted)" : "var(--text)",
                      background: "transparent",
                      border: "none",
                      borderRadius: "6px",
                      cursor: disabled ? "not-allowed" : "pointer",
                      textAlign: "left" as const,
                      opacity: disabled ? 0.4 : 1,
                      transition: "background 100ms ease",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Open in button + dropdown wrapper */}
        <div ref={openInRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setOpenDropdown(openDropdown === "openin" ? null : "openin")}
            style={{
              padding: "5px 12px",
              fontSize: "12px",
              fontWeight: "600",
              fontFamily: "var(--font-body)",
              color: "#a78bfa",
              background: "rgba(167, 139, 250, 0.1)",
              border: "1px solid rgba(167, 139, 250, 0.25)",
              borderRadius: "0 6px 6px 0",
              cursor: "pointer",
              transition: "all 180ms ease",
            }}
          >
            Open in&hellip; &#9662;
          </button>

          {/* Open in dropdown */}
          {openDropdown === "openin" && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                ...(openInAlign === "right" ? { right: 0 } : { left: 0 }),
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                boxShadow: "var(--shadow-md)",
                padding: "4px",
                zIndex: 5,
                minWidth: "170px",
                animation: "fadeIn 100ms ease",
              }}
            >
              <div
                style={{
                  padding: "6px 10px",
                  fontSize: "11px",
                  color: "var(--muted)",
                  fontStyle: "italic",
                  fontFamily: "var(--font-body)",
                }}
              >
                Copy your summary first
              </div>
              <div style={{ height: "1px", background: "var(--border)", margin: "4px 0" }} />
              {targets.map((target) => {
                const isUnconfigured = !target.url;
                return (
                  <button
                    key={target.name}
                    type="button"
                    onClick={() => handleOpenService(target)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                      padding: "6px 10px",
                      fontSize: "13px",
                      fontFamily: "var(--font-body)",
                      color: "var(--text)",
                      background: "transparent",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      textAlign: "left" as const,
                      opacity: isUnconfigured ? 0.5 : 1,
                      transition: "background 100ms ease",
                    }}
                  >
                    <span style={{ fontSize: "10px", marginRight: "8px", color: target.color }}>
                      ●
                    </span>
                    {target.name}
                    {isUnconfigured && (
                      <span
                        style={{
                          fontSize: "14px",
                          color: "var(--muted)",
                          marginLeft: "auto",
                          paddingLeft: "10px",
                        }}
                      >
                        ⚙︎
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div style={{ marginTop: "6px", fontSize: "12px", color: "var(--error-text)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
