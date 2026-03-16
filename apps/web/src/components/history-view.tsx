import { useCallback, useEffect, useState } from "preact/hooks";
import { fetchHistory, type HistoryListItem } from "../lib/api.js";
import { formatDate, formatFileSize, truncateUrl } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { getToken } from "../lib/token.js";

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
      return {
        ...base,
        background: "color-mix(in srgb, var(--accent) 15%, var(--surface))",
        color: "var(--accent)",
      };
    case "podcast":
      return {
        ...base,
        background: "color-mix(in srgb, var(--badge-podcast) 15%, var(--surface))",
        color: "var(--badge-podcast)",
      };
    case "text":
      return {
        ...base,
        background: "color-mix(in srgb, var(--muted) 15%, var(--surface))",
        color: "var(--muted)",
      };
    default:
      return {
        ...base,
        background: "color-mix(in srgb, var(--badge-article) 15%, var(--surface))",
        color: "var(--badge-article)",
      };
  }
}

/** Extract a display title: insights title → first summary heading → first summary line → fallback */
function extractDisplayTitle(entry: HistoryListItem): string {
  if (entry.title) return entry.title;

  if (entry.metadata) {
    try {
      const insights = JSON.parse(entry.metadata);
      if (insights?.title) return insights.title;
    } catch {
      /* ignore */
    }
  }

  if (entry.summary) {
    const match = entry.summary.match(/^#+\s+(.+)$/m);
    if (match) return match[1].trim();
    const firstLine = entry.summary
      .split("\n")
      .find((l) => l.trim())
      ?.trim();
    if (firstLine) {
      const cleaned = firstLine.replace(/^[#*_`]+\s*/, "").replace(/[*_`]+$/g, "");
      if (cleaned) return cleaned.length > 80 ? cleaned.slice(0, 77) + "\u2026" : cleaned;
    }
  }

  return "Untitled";
}

export function HistoryView() {
  const [entries, setEntries] = useState<HistoryListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (append = false, fromOffset = 0) => {
    setLoading(true);
    try {
      const data = await fetchHistory(20, fromOffset);
      setTotal(data.total);
      if (append) {
        setEntries((prev) => [...prev, ...data.entries]);
        setOffset(fromOffset + data.entries.length);
      } else {
        setEntries(data.entries);
        setOffset(data.entries.length);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false, 0);
  }, []);

  if (!loading && entries.length === 0) {
    return (
      <div
        style={{ color: "var(--muted)", textAlign: "center", padding: "32px 0", fontSize: "14px" }}
      >
        No summaries yet. Use Summarize_p2 on a URL or text to create your first one.
      </div>
    );
  }

  const token = getToken();

  return (
    <div>
      {entries.map((entry) => (
        <div
          key={entry.id}
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/s/${entry.id}`)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              navigate(`/s/${entry.id}`);
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
          {/* Title: summary title */}
          <div
            style={{
              fontWeight: "500",
              fontSize: "15px",
              marginBottom: "2px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {extractDisplayTitle(entry)}
          </div>
          {/* Subtitle: source URL / filename */}
          {entry.sourceUrl && (
            <div
              style={{
                fontSize: "13px",
                color: "var(--muted)",
                marginBottom: "4px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {truncateUrl(entry.sourceUrl, 70)}
            </div>
          )}
          {/* Footer: badge, date, model, media link */}
          <div
            style={{
              fontSize: "12px",
              color: "var(--muted)",
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span style={badgeStyle(entry.sourceType)}>{entry.sourceType || "article"}</span>
            <span>{formatDate(entry.createdAt)}</span>
            <span>{entry.model}</span>
            {entry.hasMedia && (
              <a
                href={`/v1/history/${entry.id}/media?token=${encodeURIComponent(token)}`}
                download
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: "inherit",
                  borderBottom: "1px dotted currentColor",
                  textDecoration: "none",
                }}
              >
                {"\u2193"} Media
                {entry.mediaSize != null ? ` (${formatFileSize(entry.mediaSize)})` : ""}
              </a>
            )}
            {entry.hasAudio && (
              <a
                href={`/v1/history/${entry.id}/audio?token=${encodeURIComponent(token)}`}
                download
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: "inherit",
                  borderBottom: "1px dotted currentColor",
                  textDecoration: "none",
                }}
              >
                {"\u2193"} Audio
                {entry.audioSize != null ? ` (${formatFileSize(entry.audioSize)})` : ""}
              </a>
            )}
          </div>
        </div>
      ))}

      {offset < total && (
        <button
          type="button"
          onClick={() => {
            void load(true, offset);
          }}
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
