import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { authMiddleware } from "../src/server/middleware/auth.js";

function createTestApp(token: string | null) {
  const app = new Hono();
  app.use("*", authMiddleware(token));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("auth middleware", () => {
  it("rejects when no token configured", async () => {
    const app = createTestApp(null);
    const res = await app.request("/test");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_ERROR");
  });

  it("rejects missing Authorization header", async () => {
    const app = createTestApp("secret");
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("rejects wrong token", async () => {
    const app = createTestApp("secret");
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts correct token", async () => {
    const app = createTestApp("secret");
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("accepts token via query param when no Authorization header", async () => {
    const app = createTestApp("secret-token");
    const res = await app.request("/test?token=secret-token");
    expect(res.status).toBe(200);
  });

  it("rejects invalid query param token", async () => {
    const app = createTestApp("secret-token");
    const res = await app.request("/test?token=wrong");
    expect(res.status).toBe(401);
  });

  it("prefers Authorization header over query param", async () => {
    const app = createTestApp("secret-token");
    const res = await app.request("/test?token=wrong", {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(res.status).toBe(200);
  });
});
