import { Hono } from "hono";
import type { Account } from "../../config/types.js";

export function createDefaultTokenRoute(accounts: Account[]) {
  const route = new Hono();

  route.get("/default-token", (c) => {
    const anonymous = accounts.find((a) => a.name === "anonymous");
    if (!anonymous) {
      return c.json({ error: { code: "NOT_FOUND", message: "No default token available" } }, 404);
    }
    return c.json({ token: anonymous.token, account: "anonymous" });
  });

  return route;
}
