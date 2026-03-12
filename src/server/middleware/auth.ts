import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function authMiddleware(token: string | null) {
  return createMiddleware(async (c, next) => {
    if (!token) {
      console.warn("[summarize-api] auth: API token not configured on server");
      return c.json({ error: { code: "SERVER_ERROR", message: "API token not configured" } }, 500);
    }
    const header = c.req.header("Authorization");
    const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    // Fall back to query param for <audio>/<video> src attributes
    const queryToken = c.req.query("token")?.trim();
    const candidate = bearer || queryToken || "";
    if (!candidate || !safeCompare(candidate, token)) {
      console.warn(
        `[summarize-api] auth: rejected ${c.req.method} ${c.req.path} — ${candidate ? "invalid token" : "missing token"}`,
      );
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid or missing bearer token" } },
        401,
      );
    }
    await next();
  });
}
