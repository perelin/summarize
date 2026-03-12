import { createMiddleware } from "hono/factory";
import type { Account } from "../../config/types.js";

export function authMiddleware(accounts: Account[]) {
  // Map lookup (not timing-safe) is acceptable for friend-sharing scope.
  // For public-facing auth with high-value tokens, consider constant-time comparison.
  const tokenMap = new Map<string, string>();
  for (const account of accounts) {
    tokenMap.set(account.token, account.name);
  }

  return createMiddleware(async (c, next) => {
    if (tokenMap.size === 0) {
      console.warn("[summarize-api] auth: no accounts configured on server");
      return c.json({ error: { code: "SERVER_ERROR", message: "No accounts configured" } }, 500);
    }

    const header = c.req.header("Authorization");
    const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    // Fall back to query param for <audio>/<video> src attributes
    const queryToken = c.req.query("token")?.trim();
    const candidate = bearer || queryToken || "";

    const accountName = candidate ? tokenMap.get(candidate) : undefined;
    if (!accountName) {
      console.warn(
        `[summarize-api] auth: rejected ${c.req.method} ${c.req.path} — ${candidate ? "invalid token" : "missing token"}`,
      );
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid or missing bearer token" } },
        401,
      );
    }

    c.set("account", accountName);
    await next();
  });
}
