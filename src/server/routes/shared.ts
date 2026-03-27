import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { HistoryStore } from "../../history.js";
import type { ApiLength } from "../types.js";
import { mapApiLength } from "../utils/length-map.js";

// In-memory rate limiter for public resummarize endpoint
const rateLimits = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

let cleanupCounter = 0;

function checkRateLimit(token: string): boolean {
  const now = Date.now();
  // Periodic cleanup to prevent unbounded memory growth
  if (++cleanupCounter % 100 === 0) {
    for (const [k, v] of rateLimits) {
      if (now - v.windowStart > RATE_LIMIT_WINDOW_MS) rateLimits.delete(k);
    }
  }
  const entry = rateLimits.get(token);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(token, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

export type SharedRouteDeps = {
  historyStore: HistoryStore;
  app?: Hono;
  internalAuthHeader?: string;
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
    const stored = deps.historyStore.setShareToken(id, account, token);

    const proto = c.req.header("x-forwarded-proto") ?? "https";
    const host = c.req.header("host") ?? "localhost";

    if (!stored) {
      // Race: another request set a token between our check and set. Return the existing one.
      const raceToken = deps.historyStore.getShareToken(id, account);
      if (raceToken) {
        return c.json({ token: raceToken, url: `${proto}://${host}/share/${raceToken}` });
      }
      return c.json(
        { error: { code: "STORE_FAILED", message: "Failed to create share link" } },
        500,
      );
    }

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
    if (!/^[A-Za-z0-9_-]{12}$/.test(token)) {
      return c.json({ error: { code: "NOT_FOUND", message: "Shared content not found" } }, 404);
    }
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

  // POST /shared/:token/resummarize — public re-summarize (rate-limited, transient)
  route.post("/shared/:token/resummarize", async (c) => {
    const token = c.req.param("token");
    if (!/^[A-Za-z0-9_-]{12}$/.test(token)) {
      return c.json({ error: { code: "NOT_FOUND", message: "Shared content not found" } }, 404);
    }
    const entry = deps.historyStore.getByShareToken(token);
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "Shared content not found" } }, 404);
    }

    if (!entry.transcript || entry.transcript.length === 0) {
      return c.json(
        {
          error: {
            code: "NO_TRANSCRIPT",
            message: "No source text available for re-summarization",
          },
        },
        422,
      );
    }

    // Parse and validate length
    const body = await c.req
      .json<{ length?: ApiLength }>()
      .catch((): { length?: ApiLength } => ({}));
    if (!body.length) {
      return c.json(
        { error: { code: "MISSING_LENGTH", message: "length parameter is required" } },
        400,
      );
    }

    try {
      mapApiLength(body.length);
    } catch {
      return c.json(
        { error: { code: "INVALID_LENGTH", message: `Invalid length: ${body.length}` } },
        400,
      );
    }

    // Rate limit by share token
    if (!checkRateLimit(token)) {
      return c.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } },
        429,
      );
    }

    // Check internal dispatch is configured
    if (!deps.app || !deps.internalAuthHeader) {
      return c.json(
        { error: { code: "SERVICE_UNAVAILABLE", message: "Re-summarization not available" } },
        503,
      );
    }

    console.log(`[summarize-api] public resummarize: token=${token} length=${body.length}`);

    // Dispatch internal request to /v1/summarize using server's own auth
    const internalReq = new Request("http://internal/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: deps.internalAuthHeader,
      },
      body: JSON.stringify({
        text: entry.transcript,
        length: body.length,
      }),
    });

    const internalRes = await deps.app.fetch(internalReq);

    if (!internalRes.ok || !internalRes.body) {
      const errBody = await internalRes.text().catch(() => "");
      console.error(
        "[summarize-api] public resummarize internal request failed:",
        internalRes.status,
        errBody,
      );
      return c.json(
        { error: { code: "SUMMARIZE_FAILED", message: "Re-summarization failed" } },
        502,
      );
    }

    // Stream SSE response through without intercepting/persisting (transient)
    return new Response(internalRes.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return route;
}
