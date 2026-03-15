import { useEffect, useState } from "preact/hooks";
import {
  deleteHistoryEntry,
  fetchHistoryDetail,
  type HistoryDetailEntry,
  type SummarizeInsights,
} from "../lib/api.js";
import { formatDate, formatDuration, formatFileSize, truncateUrl } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { getToken } from "../lib/token.js";
import { ChatPanel } from "./chat-panel.js";
import { SlidesViewer } from "./slides-viewer.js";
import { StreamingMarkdown } from "./streaming-markdown.js";
import "../styles/markdown.css";

/** Download a file using Authorization header instead of a query-string token. */
async function downloadWithAuth(url: string): Promise<void> {
  const token = getToken();
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    // Extract filename from Content-Disposition or URL path
    const disposition = res.headers.get("Content-Disposition");
    const filenameMatch = disposition?.match(/filename="?([^";\n]+)"?/);
    a.download = filenameMatch?.[1] ?? url.split("/").pop() ?? "download";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Download failed";
    alert(msg);
  }
}

export function SummaryDetail({ id }: { id: string }) {
  const [entry, setEntry] = useState<HistoryDetailEntry | null>(null);
  const [error, setError] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    setEntry(null);
    setError("");
    fetchHistoryDetail(id)
      .then(setEntry)
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <div>
        <BackButton />
        <div style={{ color: "var(--error-text)", padding: "24px 0" }}>{error}</div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div>
        <BackButton />
        <div style={{ color: "var(--muted)", padding: "24px 0" }}>Loading\u2026</div>
      </div>
    );
  }

  const metadata = parseMetadata(entry.metadata);
  const isVideo =
    entry.sourceType === "video" ||
    (metadata?.transcriptSource &&
      (metadata.transcriptSource.includes("youtube") || metadata.transcriptSource === "yt-dlp"));

  const handleDelete = async () => {
    if (!confirm("Delete this history entry? This cannot be undone.")) return;
    try {
      await deleteHistoryEntry(id);
      navigate("/history");
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div>
      <BackButton />

      <StreamingMarkdown text={entry.summary || ""} />

      {/* Metadata */}
      <MetaBar entry={entry} insights={metadata} />

      {/* Media player */}
      {entry.hasMedia && entry.mediaUrl && (
        <MediaPlayer mediaUrl={entry.mediaUrl} mediaType={entry.mediaType} />
      )}

      {/* Slides */}
      {isVideo && <SlidesViewer summaryId={id} />}

      {/* Transcript */}
      {entry.hasTranscript && entry.transcript && (
        <div>
          <button
            type="button"
            onClick={() => setShowTranscript(!showTranscript)}
            style={{
              marginTop: "14px",
              padding: "8px 12px",
              fontSize: "13px",
              fontWeight: "500",
              fontFamily: "var(--font-body)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              cursor: "pointer",
              width: "100%",
              textAlign: "left" as const,
              color: "var(--text)",
              transition: "border-color 180ms ease, background 180ms ease",
            }}
          >
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </button>
          {showTranscript && (
            <div
              style={{
                marginTop: "8px",
                padding: "14px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                fontSize: "14px",
                lineHeight: "1.6",
                maxHeight: "400px",
                overflowY: "auto" as const,
                whiteSpace: "pre-wrap" as const,
                color: "var(--text)",
              }}
            >
              {entry.transcript}
            </div>
          )}
        </div>
      )}

      {/* Chat */}
      <ChatPanel summaryId={id} />

      {/* Delete */}
      <button
        type="button"
        onClick={handleDelete}
        style={{
          marginTop: "14px",
          padding: "8px 14px",
          fontSize: "13px",
          fontWeight: "500",
          fontFamily: "var(--font-body)",
          color: "var(--danger-text)",
          background: "var(--danger-bg)",
          border: "1px solid var(--danger-border)",
          borderRadius: "8px",
          cursor: "pointer",
          transition: "background 180ms ease",
        }}
      >
        Delete this entry
      </button>
    </div>
  );
}

function BackButton() {
  return (
    <button
      type="button"
      onClick={() => navigate("/history")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "13px",
        fontFamily: "var(--font-body)",
        color: "var(--muted)",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "4px 0",
        marginBottom: "14px",
        transition: "color 150ms ease",
      }}
    >
      {"\u2190"} Back to history
    </button>
  );
}

function MetaBar({
  entry,
  insights,
}: {
  entry: HistoryDetailEntry;
  insights: SummarizeInsights | null;
}) {
  const token = getToken();
  const parts: preact.ComponentChildren[] = [];

  if (entry.sourceUrl) {
    parts.push(
      <a href={entry.sourceUrl} target="_blank" rel="noopener" style={{ color: "inherit" }}>
        {truncateUrl(entry.sourceUrl, 50)}
      </a>,
    );
  }
  parts.push(<span>{entry.model}</span>);
  parts.push(<span>{entry.inputLength}</span>);
  parts.push(<span>{formatDate(entry.createdAt)}</span>);

  if (insights?.costUsd != null) {
    parts.push(<span>Cost: ${insights.costUsd.toFixed(4)}</span>);
  }
  if (insights?.inputTokens != null || insights?.outputTokens != null) {
    const total = (insights?.inputTokens ?? 0) + (insights?.outputTokens ?? 0);
    parts.push(<span>Tokens: {total.toLocaleString()}</span>);
  }

  // Download links — use programmatic fetch with Authorization header
  // to avoid leaking the bearer token in browser history and server logs.
  if (entry.hasTranscript && entry.transcriptUrl) {
    parts.push(
      <a
        href={entry.transcriptUrl}
        onClick={(e) => {
          e.preventDefault();
          downloadWithAuth(entry.transcriptUrl!);
        }}
        style={{
          color: "inherit",
          borderBottom: "1px dotted currentColor",
          textDecoration: "none",
          cursor: "pointer",
        }}
      >
        ↓ {entry.sourceType === "text" ? "Source text" : "Transcript"} (.md)
      </a>,
    );
  }
  if (entry.hasMedia && entry.mediaUrl) {
    const sizeLabel = entry.mediaSize != null ? ` (${formatFileSize(entry.mediaSize)})` : "";
    parts.push(
      <a
        href={entry.mediaUrl}
        onClick={(e) => {
          e.preventDefault();
          downloadWithAuth(entry.mediaUrl!);
        }}
        style={{
          color: "inherit",
          borderBottom: "1px dotted currentColor",
          textDecoration: "none",
          cursor: "pointer",
        }}
      >
        ↓ Media{sizeLabel}
      </a>,
    );
  }

  return (
    <div
      style={{
        marginTop: "12px",
        padding: "0 4px",
        fontSize: "12px",
        fontFamily: "var(--font-mono)",
        color: "var(--muted)",
        display: "flex",
        flexWrap: "wrap",
        gap: "4px 14px",
        opacity: 0.75,
      }}
    >
      {parts.map((part, i) => (
        <span key={i}>{part}</span>
      ))}
    </div>
  );
}

function MediaPlayer({ mediaUrl, mediaType }: { mediaUrl: string; mediaType: string | null }) {
  const token = getToken();
  // <audio>/<video> src attributes cannot set Authorization headers,
  // so query-param token is the only option for media elements.
  const src = `${mediaUrl}?token=${encodeURIComponent(token)}`;
  const isVideo = mediaType?.startsWith("video/");

  if (isVideo) {
    return (
      <video
        controls
        src={src}
        style={{
          width: "100%",
          marginTop: "14px",
          borderRadius: "10px",
        }}
      />
    );
  }

  return <audio controls src={src} style={{ width: "100%", marginTop: "14px" }} />;
}

function parseMetadata(raw: string | null): SummarizeInsights | null {
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}
