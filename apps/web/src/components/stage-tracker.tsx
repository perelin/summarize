import { useState } from "preact/hooks";
import type { UiStageId, UiStageStatus } from "../lib/api.js";

export type StageState = {
  status: UiStageStatus;
  detail?: string | null;
  elapsedMs?: number | null;
};

type Props = {
  stages: Record<UiStageId, StageState>;
  /** Whether the entire pipeline has finished (all stages resolved). */
  done: boolean;
  /** Total elapsed seconds (shown in collapsed badge). */
  elapsed: number;
};

const STAGE_LABELS: Record<UiStageId, string> = {
  fetch: "Fetching content",
  extract: "Extracting text",
  transcribe: "Transcribing audio",
  summarize: "Summarizing",
};

const STAGE_ORDER: UiStageId[] = ["fetch", "extract", "transcribe", "summarize"];

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function StageIcon({ status }: { status: UiStageStatus }) {
  switch (status) {
    case "done":
      return <span style={{ color: "var(--accent)", fontSize: "12px" }}>&#10003;</span>;
    case "active":
      return (
        <span
          style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "var(--accent)",
            animation: "stagePulse 1.2s ease-in-out infinite",
          }}
        />
      );
    case "error":
      return <span style={{ color: "var(--error-text)", fontSize: "12px" }}>&#10007;</span>;
    case "not-needed":
      return <span style={{ color: "var(--muted)", fontSize: "11px", opacity: 0.5 }}>&#8212;</span>;
    case "pending":
    default:
      return (
        <span
          style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            border: "1.5px solid var(--border-strong)",
          }}
        />
      );
  }
}

function ProgressDots({ stages }: { stages: Record<UiStageId, StageState> }) {
  return (
    <span style={{ display: "inline-flex", gap: "3px", alignItems: "center" }}>
      {STAGE_ORDER.map((id) => {
        const { status } = stages[id];
        const color =
          status === "done"
            ? "var(--accent)"
            : status === "active"
              ? "var(--accent)"
              : status === "error"
                ? "var(--error-text)"
                : "var(--border-strong)";
        const opacity = status === "not-needed" ? 0.3 : 1;
        return (
          <span
            key={id}
            style={{
              display: "inline-block",
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: color,
              opacity,
              ...(status === "active" ? { animation: "stagePulse 1.2s ease-in-out infinite" } : {}),
            }}
          />
        );
      })}
    </span>
  );
}

export function StageTracker({ stages, done, elapsed }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Find the currently active stage for the compact display
  const activeStage = STAGE_ORDER.find((id) => stages[id].status === "active");
  const activeLabel = activeStage ? STAGE_LABELS[activeStage] : null;
  const activeDetail = activeStage ? stages[activeStage].detail : null;

  // After done, default to collapsed
  const compactText = done
    ? `Completed in ${elapsed}s`
    : activeDetail || (activeLabel ? `${activeLabel}…` : "Processing…");

  return (
    <div style={{ marginBottom: "16px" }}>
      {/* Compact bar (always shown) */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          width: "100%",
          padding: "8px 12px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: expanded ? "8px 8px 0 0" : "8px",
          cursor: "pointer",
          fontFamily: "var(--font-body)",
          fontSize: "13px",
          color: done ? "var(--muted)" : "var(--text)",
          textAlign: "left",
          transition: "border-radius 150ms ease",
        }}
      >
        <span
          style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {compactText}
        </span>
        <ProgressDots stages={stages} />
        {!done && (
          <span
            style={{ fontSize: "12px", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}
          >
            {elapsed}s
          </span>
        )}
        <span
          style={{
            fontSize: "10px",
            color: "var(--muted)",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
          }}
        >
          &#9660;
        </span>
      </button>

      {/* Expanded detail list */}
      {expanded && (
        <div
          style={{
            padding: "8px 12px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderTop: "none",
            borderRadius: "0 0 8px 8px",
            animation: "fadeIn 150ms var(--ease-out-expo)",
          }}
        >
          {STAGE_ORDER.map((id) => {
            const stage = stages[id];
            const isActive = stage.status === "active";
            const isDone = stage.status === "done";
            const isNotNeeded = stage.status === "not-needed";
            const isError = stage.status === "error";

            return (
              <div
                key={id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  padding: "4px 0",
                  opacity: isNotNeeded ? 0.45 : 1,
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "16px",
                    height: "20px",
                    flexShrink: 0,
                  }}
                >
                  <StageIcon status={stage.status} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: "13px",
                      color: isActive
                        ? "var(--text)"
                        : isDone
                          ? "var(--text)"
                          : isError
                            ? "var(--error-text)"
                            : "var(--muted)",
                      textDecoration: isNotNeeded ? "line-through" : "none",
                    }}
                  >
                    {STAGE_LABELS[id]}
                    {isNotNeeded && (
                      <span style={{ fontSize: "11px", marginLeft: "6px", fontStyle: "italic" }}>
                        not needed
                      </span>
                    )}
                  </span>
                  {isActive && stage.detail && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--muted)",
                        marginTop: "1px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {stage.detail}
                    </div>
                  )}
                </div>
                {(isDone || isError) && stage.elapsedMs != null && (
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--muted)",
                      fontVariantNumeric: "tabular-nums",
                      flexShrink: 0,
                    }}
                  >
                    {formatMs(stage.elapsedMs)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes stagePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
