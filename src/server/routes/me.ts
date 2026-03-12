import { Hono } from "hono";

export function createMeRoute(): Hono {
  const route = new Hono();

  route.get("/me", (c) => {
    const account = c.get("account") as string;
    return c.json({ account: { name: account } });
  });

  return route;
}
