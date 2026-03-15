import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import type { HistoryStore } from "../../history.js";

export type HistoryRouteDeps = {
  historyStore: HistoryStore;
  historyMediaPath: string | null;
};

type Variables = { account: string };

export function createHistoryRoute(deps: HistoryRouteDeps): Hono<{ Variables: Variables }> {
  const route = new Hono<{ Variables: Variables }>();

  // GET /history — paginated list
  route.get("/history", (c) => {
    const account = c.get("account") as string;
    const limitParam = parseInt(c.req.query("limit") ?? "20", 10);
    const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10));
    const limit = Math.min(Math.max(1, isNaN(limitParam) ? 20 : limitParam), 100);

    const { entries, total } = deps.historyStore.list({ account, limit, offset });

    return c.json({ entries, total, limit, offset });
  });

  // GET /history/:id — single entry with full detail
  route.get("/history/:id", (c) => {
    const account = c.get("account") as string;
    const entry = deps.historyStore.getById(c.req.param("id"), account);
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "History entry not found" } }, 404);
    }

    const hasMedia = entry.mediaPath != null && entry.mediaPath.length > 0;
    const hasTranscript = entry.transcript != null && entry.transcript.length > 0;
    return c.json({
      ...entry,
      hasTranscript,
      hasMedia,
      mediaUrl: hasMedia ? `/v1/history/${entry.id}/media` : null,
      transcriptUrl: hasTranscript ? `/v1/history/${entry.id}/transcript` : null,
    });
  });

  // GET /history/:id/media — serve media file
  route.get("/history/:id/media", (c) => {
    const account = c.get("account") as string;
    const entry = deps.historyStore.getById(c.req.param("id"), account);
    if (!entry?.mediaPath || !deps.historyMediaPath) {
      return c.json({ error: { code: "NOT_FOUND", message: "Media not found" } }, 404);
    }

    const filePath = join(deps.historyMediaPath, entry.mediaPath);
    if (!existsSync(filePath)) {
      return c.json({ error: { code: "NOT_FOUND", message: "Media file not found on disk" } }, 404);
    }

    const contentType = entry.mediaType ?? "application/octet-stream";
    const stream = createReadStream(filePath);
    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": contentType,
        ...(entry.mediaSize != null ? { "Content-Length": String(entry.mediaSize) } : {}),
      },
    });
  });

  // GET /history/:id/transcript — serve transcript as .md file
  route.get("/history/:id/transcript", (c) => {
    const account = c.get("account") as string;
    const entry = deps.historyStore.getById(c.req.param("id"), account);
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "History entry not found" } }, 404);
    }
    if (!entry.transcript || entry.transcript.length === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "No transcript available" } }, 404);
    }

    // Parse metadata for frontmatter fields
    let insights: Record<string, unknown> | null = null;
    if (entry.metadata) {
      try {
        insights = JSON.parse(entry.metadata);
      } catch {
        // ignore malformed metadata
      }
    }

    const lines: string[] = ["---"];
    if (entry.title) lines.push(`title: "${entry.title.replace(/"/g, '\\"')}"`);
    if (entry.sourceUrl) lines.push(`source: "${entry.sourceUrl}"`);
    lines.push(`date: "${entry.createdAt}"`);
    lines.push(`source_type: "${entry.sourceType}"`);
    lines.push(`model: "${entry.model}"`);
    if (insights) {
      const dur = insights.mediaDurationSeconds as number | null;
      if (dur != null) {
        const h = Math.floor(dur / 3600);
        const m = Math.floor((dur % 3600) / 60);
        const s = Math.floor(dur % 60);
        const formatted =
          h > 0
            ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
            : `${m}:${String(s).padStart(2, "0")}`;
        lines.push(`duration: "${formatted}"`);
      }
      if (insights.transcriptionProvider) {
        lines.push(`transcription_provider: "${insights.transcriptionProvider}"`);
      }
      if (insights.transcriptSource) {
        lines.push(`transcript_source: "${insights.transcriptSource}"`);
      }
      if (insights.wordCount != null) {
        lines.push(`word_count: ${insights.wordCount}`);
      }
    }
    lines.push("---", "", entry.transcript);

    const md = lines.join("\n");
    const slug = (entry.title ?? "transcript")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    const filename = `${slug}-transcript.md`;

    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(new TextEncoder().encode(md).byteLength),
      },
    });
  });

  // DELETE /history/:id — delete entry + media
  route.delete("/history/:id", async (c) => {
    const account = c.get("account") as string;
    const entry = deps.historyStore.getById(c.req.param("id"), account);
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "History entry not found" } }, 404);
    }

    // Delete media file if present
    if (entry.mediaPath && deps.historyMediaPath) {
      const filePath = join(deps.historyMediaPath, entry.mediaPath);
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(filePath);
      } catch {
        // File may already be gone — that's fine
      }
    }

    deps.historyStore.deleteById(c.req.param("id"), account);
    return new Response(null, { status: 204 });
  });

  return route;
}
