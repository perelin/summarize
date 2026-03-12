import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import type { HistoryStore } from "../../history.js";

export type HistoryRouteDeps = {
  historyStore: HistoryStore;
  historyMediaPath: string | null;
};

export function createHistoryRoute(deps: HistoryRouteDeps): Hono {
  const route = new Hono();

  // GET /history — paginated list
  route.get("/history", (c) => {
    const limitParam = parseInt(c.req.query("limit") ?? "20", 10);
    const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10));
    const limit = Math.min(Math.max(1, isNaN(limitParam) ? 20 : limitParam), 100);

    const { entries, total } = deps.historyStore.list({ limit, offset });

    return c.json({ entries, total, limit, offset });
  });

  // GET /history/:id — single entry with full detail
  route.get("/history/:id", (c) => {
    const entry = deps.historyStore.getById(c.req.param("id"));
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "History entry not found" } }, 404);
    }

    const hasMedia = entry.mediaPath != null && entry.mediaPath.length > 0;
    return c.json({
      ...entry,
      hasTranscript: entry.transcript != null && entry.transcript.length > 0,
      hasMedia,
      mediaUrl: hasMedia ? `/v1/history/${entry.id}/media` : null,
    });
  });

  // GET /history/:id/media — serve media file
  route.get("/history/:id/media", (c) => {
    const entry = deps.historyStore.getById(c.req.param("id"));
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

  // DELETE /history/:id — delete entry + media
  route.delete("/history/:id", async (c) => {
    const entry = deps.historyStore.getById(c.req.param("id"));
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

    deps.historyStore.deleteById(c.req.param("id"));
    return new Response(null, { status: 204 });
  });

  return route;
}
