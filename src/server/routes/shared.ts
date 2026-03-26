import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { HistoryStore } from "../../history.js";

export type SharedRouteDeps = {
  historyStore: HistoryStore;
};

type Variables = { account: string };

export function createSharedRoute(deps: SharedRouteDeps): Hono<{ Variables: Variables }> {
  const route = new Hono<{ Variables: Variables }>();

  // POST /history/:id/share — create (or return existing) share token
  route.post("/history/:id/share", (c) => {
    const account = c.get("account") as string;
    const id = c.req.param("id");

    const entry = deps.historyStore.getById(id, account);
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "History entry not found" } }, 404);
    }

    // Check for existing token (idempotent)
    const existing = deps.historyStore.getShareToken(id, account);
    if (existing) {
      const proto = c.req.header("x-forwarded-proto") ?? "https";
      const host = c.req.header("host") ?? "localhost";
      return c.json({ token: existing, url: `${proto}://${host}/share/${existing}` });
    }

    // Generate 12-char URL-safe token
    const token = randomBytes(9).toString("base64url").slice(0, 12);
    deps.historyStore.setShareToken(id, account, token);

    const proto = c.req.header("x-forwarded-proto") ?? "https";
    const host = c.req.header("host") ?? "localhost";
    return c.json({ token, url: `${proto}://${host}/share/${token}` });
  });

  // DELETE /history/:id/share — revoke share token
  route.delete("/history/:id/share", (c) => {
    const account = c.get("account") as string;
    const id = c.req.param("id");

    const cleared = deps.historyStore.clearShareToken(id, account);
    if (!cleared) {
      return c.json({ error: { code: "NOT_FOUND", message: "No active share link" } }, 404);
    }

    return new Response(null, { status: 204 });
  });

  // GET /shared/:token — public access (no auth)
  route.get("/shared/:token", (c) => {
    const token = c.req.param("token");
    const entry = deps.historyStore.getByShareToken(token);
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "Shared content not found" } }, 404);
    }

    // Parse metadata to extract safe fields
    let mediaDurationSeconds: number | null = null;
    let wordCount: number | null = null;
    if (entry.metadata) {
      try {
        const parsed = JSON.parse(entry.metadata);
        if (typeof parsed.mediaDurationSeconds === "number") {
          mediaDurationSeconds = parsed.mediaDurationSeconds;
        }
        if (typeof parsed.wordCount === "number") {
          wordCount = parsed.wordCount;
        }
      } catch {
        // ignore malformed metadata
      }
    }

    return c.json({
      title: entry.title,
      summary: entry.summary,
      sourceUrl: entry.sourceUrl,
      sourceType: entry.sourceType,
      model: entry.model,
      createdAt: entry.createdAt,
      inputLength: entry.inputLength,
      metadata: { mediaDurationSeconds, wordCount },
    });
  });

  return route;
}
