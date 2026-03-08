import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function authMiddleware(token: string | null) {
  return createMiddleware(async (c, next) => {
    if (!token) {
      return c.json(
        { error: { code: "SERVER_ERROR", message: "API token not configured" } },
        500,
      );
    }
    const header = c.req.header("Authorization");
    const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!bearer || !safeCompare(bearer, token)) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid or missing bearer token" } },
        401,
      );
    }
    await next();
  });
}
