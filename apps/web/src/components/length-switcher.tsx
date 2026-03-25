import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { type ApiLength, resummarizeSSE } from "../lib/api.js";

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

/** Map the internal length value stored in history to an ApiLength key. */
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

type Props = {
  entryId: string;
  inputLength: string;
  onStreamStart: () => void;
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
  disabled?: boolean;
};

export function LengthSwitcher({
  entryId,
  inputLength,
  onStreamStart,
  onChunk,
  onDone,
  onError,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [align, setAlign] = useState<"left" | "right">("right");
  const abortRef = useRef<AbortController | null>(null);

  const currentApiLength = toApiLength(inputLength);

  useLayoutEffect(() => {
    if (!open || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setAlign(rect.right > window.innerWidth - 8 ? "right" : "left");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleSelect = (option: LengthOption) => {
    if (option.key === currentApiLength || loading) return;
    setOpen(false);
    setLoading(true);
    onStreamStart();

    abortRef.current = resummarizeSSE(
      entryId,
      { length: option.key },
      {
        onChunk: (text) => onChunk(text),
        onDone: () => {
          setLoading(false);
          onDone();
        },
        onError: (message) => {
          setLoading(false);
          onError(message);
        },
      },
    );
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", marginLeft: "auto" }}>
      <button
        type="button"
        onClick={() => !loading && setOpen(!open)}
        disabled={disabled || loading}
        style={{
          padding: "5px 12px",
          fontSize: "12px",
          fontWeight: "600",
          fontFamily: "var(--font-body)",
          color: loading ? "var(--muted)" : "var(--text)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          cursor: loading ? "wait" : "pointer",
          transition: "all 180ms ease",
          display: "flex",
          alignItems: "center",
          gap: "4px",
          whiteSpace: "nowrap",
        }}
      >
        {loading ? (
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
            {toDisplayLabel(inputLength)}
            {" \u25BE"}
          </>
        )}
      </button>

      {open && !loading && (
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
                onClick={() => handleSelect(option)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  padding: "6px 10px",
                  fontSize: "13px",
                  fontFamily: "var(--font-body)",
                  color: isCurrent ? "var(--accent)" : "var(--text)",
                  background: isCurrent ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
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
  );
}
