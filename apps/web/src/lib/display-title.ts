import type { HistoryEntry } from "./api.js";

/** Extract a display title: entry.title -> insights title -> first summary heading -> first summary line -> fallback */
export function extractDisplayTitle(
  entry: Pick<HistoryEntry, "title" | "metadata" | "summary">,
): string {
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
