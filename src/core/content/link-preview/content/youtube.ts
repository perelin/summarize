import { normalizeWhitespace } from "./cleaner.js";

function extractBalancedJsonObject(source: string, startAt: number): string | null {
  const start = source.indexOf("{", startAt);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (!ch) {
      continue;
    }

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (quote && ch === quote) {
        inString = false;
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
}

function extractVideoDetails(html: string): Record<string, unknown> | null {
  const tokenIndex = html.indexOf("ytInitialPlayerResponse");
  if (tokenIndex < 0) {
    return null;
  }
  const assignmentIndex = html.indexOf("=", tokenIndex);
  if (assignmentIndex < 0) {
    return null;
  }
  const objectText = extractBalancedJsonObject(html, assignmentIndex);
  if (!objectText) {
    return null;
  }

  try {
    const parsed = JSON.parse(objectText) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const videoDetails = (parsed as Record<string, unknown>).videoDetails;
    if (!videoDetails || typeof videoDetails !== "object") {
      return null;
    }
    return videoDetails as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extract the video title from ytInitialPlayerResponse.videoDetails.title */
export function extractYouTubeVideoTitle(html: string): string | null {
  const details = extractVideoDetails(html);
  if (!details) return null;
  const title = details.title;
  if (typeof title !== "string") return null;
  const normalized = normalizeWhitespace(title);
  return normalized && normalized.length > 0 ? normalized : null;
}

export function extractYouTubeShortDescription(html: string): string | null {
  const details = extractVideoDetails(html);
  if (!details) return null;
  const description = details.shortDescription;
  if (typeof description !== "string") return null;
  const normalized = normalizeWhitespace(description);
  return normalized && normalized.length > 0 ? normalized : null;
}
