import { Hono } from "hono";

type Variables = { account: string };

export function createMeRoute(): Hono<{ Variables: Variables }> {
  const route = new Hono<{ Variables: Variables }>();

  route.get("/me", (c) => {
    const account = c.get("account") as string;
    return c.json({ account: { name: account } });
  });

  return route;
}
