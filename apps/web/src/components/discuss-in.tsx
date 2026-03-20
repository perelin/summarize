import { useEffect, useRef, useState } from "preact/hooks";
import type { HistoryDetailEntry } from "../lib/api.js";
import { extractDisplayTitle } from "../lib/display-title.js";
import { getSettings } from "../lib/settings.js";

type ContentOption = "summary" | "transcript" | "both";

type AiTarget = {
  name: string;
  url: string | null;
  color: string;
  hoverColor: string;
};

function getAiTargets(): AiTarget[] {
  const settings = getSettings();
  return [
    { name: "Claude", url: "https://claude.ai/new", color: "#d97706", hoverColor: "#b45309" },
    { name: "ChatGPT", url: "https://chatgpt.com", color: "#059669", hoverColor: "#047857" },
    { name: "Gemini", url: "https://gemini.google.com", color: "#2563eb", hoverColor: "#1d4ed8" },
    { name: "OpenWebUI", url: settings.openWebUiUrl, color: "#7c3aed", hoverColor: "#6d28d9" },
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
  const [openTarget, setOpenTarget] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const title = extractDisplayTitle(entry);
  const hasSummary = Boolean(entry.summary);
  const hasTranscript = Boolean(entry.hasTranscript && entry.transcript);

  // Close popover on outside click or Escape
  useEffect(() => {
    if (!openTarget) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenTarget(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenTarget(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openTarget]);

  const handleSelect = async (target: AiTarget, option: ContentOption) => {
    setOpenTarget(null);
    setError(null);
    try {
      const content = buildClipboardContent(entry, option, title);
      await navigator.clipboard.writeText(content);
      window.open(target.url!, "_blank", "noopener");
      setFeedbackTarget(target.name);
      setTimeout(() => setFeedbackTarget(null), 2000);
    } catch {
      setError("Clipboard access denied");
      setTimeout(() => setError(null), 3000);
    }
  };

  const targets = getAiTargets();

  return (
    <div style={{ marginTop: "18px" }}>
      <div
        style={{
          fontSize: "12px",
          fontWeight: "500",
          color: "var(--muted)",
          marginBottom: "8px",
          fontFamily: "var(--font-body)",
        }}
      >
        Discuss in&hellip;
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", position: "relative" }}>
        {targets.map((target) => {
          const isUnconfigured = !target.url;
          const isFeedback = feedbackTarget === target.name;
          return (
            <div key={target.name} style={{ position: "relative" }}>
              <button
                type="button"
                title={isUnconfigured ? "Configure URL in settings" : `Discuss in ${target.name}`}
                onClick={() => {
                  if (isUnconfigured) {
                    window.dispatchEvent(new CustomEvent("open-settings"));
                    return;
                  }
                  setOpenTarget(openTarget === target.name ? null : target.name);
                }}
                style={{
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: "600",
                  fontFamily: "var(--font-body)",
                  color: isFeedback
                    ? "var(--accent-text)"
                    : isUnconfigured
                      ? "var(--muted)"
                      : target.color,
                  background: isFeedback
                    ? "var(--accent)"
                    : isUnconfigured
                      ? "var(--surface)"
                      : `color-mix(in srgb, ${target.color} 10%, var(--surface))`,
                  border: `1px solid ${isFeedback ? "var(--accent)" : isUnconfigured ? "var(--border)" : `color-mix(in srgb, ${target.color} 25%, var(--border))`}`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  transition: "all 180ms ease",
                  opacity: isUnconfigured ? 0.6 : 1,
                }}
              >
                {isFeedback ? "Copied! Paste in chat" : target.name}
                {isUnconfigured && !isFeedback && " \u2699"}
              </button>

              {/* Popover */}
              {openTarget === target.name && (
                <div
                  ref={popoverRef}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
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
                          if (!disabled) void handleSelect(target, key);
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
          );
        })}
      </div>
      {error && (
        <div
          style={{
            marginTop: "6px",
            fontSize: "12px",
            color: "var(--error-text)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
