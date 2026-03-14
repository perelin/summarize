import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { Account } from "../../config/types.js";

function safeTokenLookup(
  accounts: Account[],
  candidate: string,
): string | undefined {
  if (!candidate) return undefined;
  const candidateBuf = Buffer.from(candidate);
  for (const account of accounts) {
    const tokenBuf = Buffer.from(account.token);
    if (
      candidateBuf.length === tokenBuf.length &&
      timingSafeEqual(candidateBuf, tokenBuf)
    ) {
      return account.name;
    }
  }
  return undefined;
}

export function authMiddleware(accounts: Account[]) {
  return createMiddleware(async (c, next) => {
    if (accounts.length === 0) {
      console.warn("[summarize-api] auth: no accounts configured on server");
      return c.json({ error: { code: "SERVER_ERROR", message: "No accounts configured" } }, 500);
    }

    const header = c.req.header("Authorization");
    const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    // Fall back to query param for <audio>/<video> src attributes
    const queryToken = c.req.query("token")?.trim();
    const candidate = bearer || queryToken || "";

    const accountName = safeTokenLookup(accounts, candidate);
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
