import { useState } from "preact/hooks";
import { fetchMe } from "../lib/api.js";
import { setToken } from "../lib/token.js";

export function TokenInput({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    setChecking(true);
    setError("");

    setToken(trimmed);
    const info = await fetchMe();
    if (info) {
      onAuthenticated();
    } else {
      setError("Invalid token. Please check and try again.");
      setChecking(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        border: "1px solid var(--border)",
        borderRadius: "16px",
        background: "var(--panel)",
        padding: "24px",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <p style={{ fontSize: "14px", color: "var(--muted)", marginBottom: "16px" }}>
        Enter your API token to get started.
      </p>
      <input
        type="text"
        value={value}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        placeholder="Paste your API token"
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
          marginBottom: "12px",
        }}
      />
      {error && (
        <p
          style={{
            fontSize: "13px",
            color: "var(--error-text)",
            marginBottom: "12px",
          }}
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={checking || !value.trim()}
        style={{
          width: "100%",
          padding: "10px 24px",
          fontSize: "15px",
          fontWeight: "700",
          fontFamily: "var(--font-body)",
          color: "var(--accent-text)",
          background: "var(--accent)",
          border: "none",
          borderRadius: "10px",
          cursor: checking ? "not-allowed" : "pointer",
          opacity: checking ? 0.5 : 1,
        }}
      >
        {checking ? "Checking\u2026" : "Connect"}
      </button>
    </form>
  );
}
