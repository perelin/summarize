import { useCallback, useEffect, useState } from "preact/hooks";
import { fetchHistory, type HistoryEntry } from "../lib/api.js";
import { formatDate, truncateUrl } from "../lib/format.js";
import { navigate } from "../lib/router.js";

function badgeStyle(type: string) {
  const base = {
    display: "inline-block",
    padding: "1px 6px",
    fontSize: "10px",
    fontWeight: "700",
    borderRadius: "4px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  };

  switch (type) {
    case "video":
      return { ...base, background: "color-mix(in srgb, var(--accent) 15%, var(--surface))", color: "var(--accent)" };
    case "podcast":
      return { ...base, background: "color-mix(in srgb, var(--badge-podcast) 15%, var(--surface))", color: "var(--badge-podcast)" };
    case "text":
      return { ...base, background: "color-mix(in srgb, var(--muted) 15%, var(--surface))", color: "var(--muted)" };
    default:
      return { ...base, background: "color-mix(in srgb, var(--badge-article) 15%, var(--surface))", color: "var(--badge-article)" };
  }
}

export function HistoryView() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (append = false) => {
    setLoading(true);
    try {
      const nextOffset = append ? offset : 0;
      const data = await fetchHistory(20, nextOffset);
      setTotal(data.total);
      if (append) {
        setEntries((prev) => [...prev, ...data.entries]);
        setOffset(nextOffset + data.entries.length);
      } else {
        setEntries(data.entries);
        setOffset(data.entries.length);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    load(false);
  }, []);

  if (!loading && entries.length === 0) {
    return (
      <div style={{ color: "var(--muted)", textAlign: "center", padding: "32px 0", fontSize: "14px" }}>
        No summaries yet. Summarize a URL or text to create your first one.
      </div>
    );
  }

  return (
    <div>
      {entries.map((entry) => (
        <div
          key={entry.id}
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/summary/${entry.id}`)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              navigate(`/summary/${entry.id}`);
            }
          }}
          style={{
            padding: "12px 4px",
            borderBottom: "1px solid var(--border)",
            cursor: "pointer",
            background: "transparent",
            transition: "background 180ms ease",
          }}
        >
          <div
            style={{
              fontWeight: "500",
              fontSize: "15px",
              marginBottom: "4px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.title || truncateUrl(entry.sourceUrl, 60) || "Text input"}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--muted)",
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <span style={badgeStyle(entry.sourceType)}>
              {entry.sourceType || "article"}
            </span>
            <span>{formatDate(entry.createdAt)}</span>
            <span>{entry.model}</span>
          </div>
        </div>
      ))}

      {offset < total && (
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          style={{
            marginTop: "12px",
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: "500",
            fontFamily: "var(--font-body)",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            cursor: "pointer",
            width: "100%",
            color: "var(--text)",
            transition: "border-color 180ms ease",
          }}
        >
          {loading ? "Loading\u2026" : "Load more"}
        </button>
      )}
    </div>
  );
}
