import { useCallback, useEffect, useState } from "preact/hooks";
import {
  triggerSlides,
  streamSlidesEvents,
  type SlideInfo,
  type SseSlidesData,
} from "../lib/api.js";

type Phase = "idle" | "extracting" | "done" | "error";

export function SlidesViewer({ summaryId }: { summaryId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("");
  const [slides, setSlides] = useState<SlideInfo[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [lightbox, setLightbox] = useState<number | null>(null);

  const handleExtract = useCallback(async () => {
    setPhase("extracting");
    setStatusText("Starting slide extraction\u2026");
    setSlides([]);
    setErrorMsg("");

    try {
      const { sessionId, sourceId } = await triggerSlides(summaryId);

      // Poll SSE events for progress
      streamSlidesEvents(summaryId, sessionId, {
        onStatus: (text) => setStatusText(text),
        onSlides: (data: SseSlidesData) => {
          setSlides(data.slides);
        },
        onDone: () => {
          setPhase("done");
        },
        onError: (message) => {
          setErrorMsg(message);
          setPhase("error");
        },
      });
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase("error");
    }
  }, [summaryId]);

  const formatTimestamp = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div style={{ marginTop: "24px" }}>
      {phase === "idle" && (
        <button
          type="button"
          onClick={() => {
            void handleExtract();
          }}
          style={{
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: "500",
            fontFamily: "var(--font-body)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            cursor: "pointer",
            color: "var(--text)",
            transition: "border-color 180ms ease",
          }}
        >
          Extract slides
        </button>
      )}

      {phase === "extracting" && (
        <div style={{ fontSize: "13px", color: "var(--muted)", padding: "12px 0" }}>
          {statusText || "Extracting slides\u2026"}
        </div>
      )}

      {phase === "error" && (
        <div
          style={{
            padding: "12px 14px",
            background: "var(--error-bg)",
            border: "1px solid var(--error-border)",
            borderRadius: "10px",
            color: "var(--error-text)",
            fontSize: "14px",
          }}
        >
          {errorMsg}
        </div>
      )}

      {slides.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "12px",
            marginTop: phase === "idle" ? "0" : "12px",
          }}
        >
          {slides.map((slide) => (
            <div
              key={slide.index}
              role="button"
              tabIndex={0}
              onClick={() => setLightbox(slide.index)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setLightbox(slide.index);
                }
              }}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "10px",
                overflow: "hidden",
                cursor: "pointer",
                background: "var(--surface)",
                transition: "border-color 180ms ease",
              }}
            >
              <img
                src={slide.imageUrl}
                alt={`Slide ${slide.index}`}
                loading="lazy"
                style={{ width: "100%", display: "block" }}
              />
              <div
                style={{
                  padding: "6px 10px",
                  fontSize: "11px",
                  color: "var(--muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {formatTimestamp(slide.timestamp)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox !== null && (
        <Lightbox
          slides={slides}
          currentIndex={lightbox}
          onClose={() => setLightbox(null)}
          onNavigate={setLightbox}
        />
      )}
    </div>
  );
}

function Lightbox({
  slides,
  currentIndex,
  onClose,
  onNavigate,
}: {
  slides: SlideInfo[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const slide = slides.find((s) => s.index === currentIndex);
  if (!slide) return null;

  const prevSlide = slides.find((s) => s.index === currentIndex - 1);
  const nextSlide = slides.find((s) => s.index === currentIndex + 1);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "24px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "90vw", maxHeight: "90vh", position: "relative" }}
      >
        <img
          src={slide.imageUrl}
          alt={`Slide ${slide.index}`}
          style={{
            maxWidth: "100%",
            maxHeight: "85vh",
            borderRadius: "8px",
            display: "block",
          }}
        />
        <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: "12px" }}>
          {prevSlide && (
            <button
              type="button"
              onClick={() => onNavigate(prevSlide.index)}
              style={lightboxNavStyle}
            >
              {"\u2190"} Prev
            </button>
          )}
          <button type="button" onClick={onClose} style={lightboxNavStyle}>
            Close
          </button>
          {nextSlide && (
            <button
              type="button"
              onClick={() => onNavigate(nextSlide.index)}
              style={lightboxNavStyle}
            >
              Next {"\u2192"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const lightboxNavStyle = {
  padding: "6px 14px",
  fontSize: "13px",
  fontWeight: "500",
  fontFamily: "var(--font-body)",
  color: "#fff",
  background: "rgba(255, 255, 255, 0.15)",
  border: "1px solid rgba(255, 255, 255, 0.2)",
  borderRadius: "6px",
  cursor: "pointer",
};
