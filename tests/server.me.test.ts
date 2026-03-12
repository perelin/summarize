import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createMeRoute } from "../src/server/routes/me.js";

function createTestApp(accountName: string) {
  const app = new Hono();
  // Simulate auth middleware setting account
  app.use("*", async (c, next) => {
    c.set("account", accountName);
    await next();
  });
  app.route("/v1", createMeRoute());
  return app;
}

describe("GET /v1/me", () => {
  it("returns account name", async () => {
    const app = createTestApp("alice");
    const res = await app.request("/v1/me");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ account: { name: "alice" } });
  });

  it("returns correct name for different account", async () => {
    const app = createTestApp("bob");
    const res = await app.request("/v1/me");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.name).toBe("bob");
  });
});
