import { useEffect, useRef, useState } from "preact/hooks";
import { getSettings, updateSettings } from "../lib/settings.js";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [openWebUiUrl, setOpenWebUiUrl] = useState(() => getSettings().openWebUiUrl ?? "");
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSave = () => {
    updateSettings({ openWebUiUrl: openWebUiUrl.trim() || null });
    onClose();
  };

  return (
    <div
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
        animation: "fadeIn 150ms ease",
      }}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "24px",
          width: "min(400px, calc(100vw - 32px))",
          boxShadow: "var(--shadow-md)",
        }}
      >
        <h2
          style={{
            fontSize: "16px",
            fontWeight: "600",
            fontFamily: "var(--font-body)",
            color: "var(--text)",
            marginBottom: "16px",
          }}
        >
          Settings
        </h2>

        <label
          style={{
            display: "block",
            fontSize: "13px",
            fontWeight: "500",
            color: "var(--text)",
            marginBottom: "6px",
          }}
        >
          OpenWebUI URL
        </label>
        <input
          type="url"
          value={openWebUiUrl}
          onInput={(e) => setOpenWebUiUrl((e.target as HTMLInputElement).value)}
          placeholder="http://localhost:3000"
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: "14px",
            fontFamily: "var(--font-body)",
            background: "var(--field-bg)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            color: "var(--text)",
            outline: "none",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
        />
        <p
          style={{
            fontSize: "12px",
            color: "var(--muted)",
            marginTop: "4px",
          }}
        >
          Base URL for your self-hosted OpenWebUI instance.
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "20px" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 14px",
              fontSize: "13px",
              fontWeight: "500",
              fontFamily: "var(--font-body)",
              color: "var(--muted)",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: "6px 14px",
              fontSize: "13px",
              fontWeight: "700",
              fontFamily: "var(--font-body)",
              color: "var(--accent-text)",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
