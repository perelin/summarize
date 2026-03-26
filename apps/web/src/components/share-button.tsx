import { useEffect, useRef, useState } from "preact/hooks";
import { createShare, deleteShare } from "../lib/api.js";

type Props = {
  entryId: string;
  sharedToken: string | null;
  onShareChange: (token: string | null) => void;
};

export function ShareButton({ entryId, sharedToken, onShareChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [showBar, setShowBar] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const shareUrl = sharedToken
    ? `${window.location.origin}/share/${encodeURIComponent(sharedToken)}`
    : null;

  const handleCreate = async () => {
    setBusy(true);
    try {
      const result = await createShare(entryId);
      onShareChange(result.token);
      const url = `${window.location.origin}/share/${encodeURIComponent(result.token)}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
      setShowBar(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create share link";
      alert(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const handleUnshare = async () => {
    if (!confirm("Remove the share link? Anyone with the link will no longer be able to access this summary.")) {
      return;
    }
    setBusy(true);
    try {
      await deleteShare(entryId);
      onShareChange(null);
      setShowBar(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to remove share link";
      alert(msg);
    } finally {
      setBusy(false);
    }
  };

  if (sharedToken === null) {
    // Not shared — show "Share" button
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleCreate()}
        style={{
          padding: "5px 12px",
          fontSize: "12px",
          fontWeight: "600",
          fontFamily: "var(--font-body)",
          color: "var(--text)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          cursor: busy ? "wait" : "pointer",
          transition: "all 180ms ease",
          display: "flex",
          alignItems: "center",
          gap: "4px",
          whiteSpace: "nowrap",
        }}
      >
        <ShareIcon />
        {busy ? "Sharing\u2026" : "Share"}
      </button>
    );
  }

  // Shared — show "Shared" button + expandable link bar
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <button
        type="button"
        onClick={() => setShowBar(!showBar)}
        style={{
          padding: "5px 12px",
          fontSize: "12px",
          fontWeight: "600",
          fontFamily: "var(--font-body)",
          color: "var(--accent)",
          background: "color-mix(in srgb, var(--accent) 8%, transparent)",
          border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
          borderRadius: "6px",
          cursor: "pointer",
          transition: "all 180ms ease",
          display: "flex",
          alignItems: "center",
          gap: "4px",
          whiteSpace: "nowrap",
        }}
      >
        <LinkIcon />
        {"Shared \u2713"}
      </button>

      {showBar && shareUrl && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 10px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "12px",
            fontFamily: "var(--font-body)",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              flex: "1 1 auto",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--muted)",
              minWidth: "0",
            }}
          >
            {shareUrl}
          </span>
          <button
            type="button"
            onClick={() => void handleCopy()}
            style={{
              padding: "3px 8px",
              fontSize: "11px",
              fontWeight: "500",
              fontFamily: "var(--font-body)",
              color: copied ? "var(--accent)" : "var(--text)",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleUnshare()}
            style={{
              padding: "3px 8px",
              fontSize: "11px",
              fontWeight: "500",
              fontFamily: "var(--font-body)",
              color: "var(--danger-text)",
              background: "var(--danger-bg)",
              border: "1px solid var(--danger-border)",
              borderRadius: "4px",
              cursor: busy ? "wait" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Unshare
          </button>
        </div>
      )}
    </div>
  );
}

// ── Inline SVG icons (14x14) ─────────────────────────────

/** Share / upload-arrow icon */
function ShareIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v8" />
      <path d="M5 5l3-3 3 3" />
      <path d="M3 10v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

/** Link / chain icon */
function LinkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1" />
    </svg>
  );
}
