import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { authMiddleware } from "../src/server/middleware/auth.js";
import type { Account } from "../src/config/types.js";

const TEST_ACCOUNTS: Account[] = [
  { name: "alice", token: "a".repeat(32) },
  { name: "bob", token: "b".repeat(32) },
];

function createTestApp(accounts: Account[]) {
  const app = new Hono();
  app.use("*", authMiddleware(accounts));
  app.get("/test", (c) => c.json({ ok: true, account: c.get("account") }));
  return app;
}

describe("auth middleware (multi-account)", () => {
  it("rejects when no accounts configured", async () => {
    const app = createTestApp([]);
    const res = await app.request("/test");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_ERROR");
  });

  it("rejects missing Authorization header", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("rejects wrong token", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts alice's token and sets account", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${"a".repeat(32)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account).toBe("alice");
  });

  it("accepts bob's token and sets account", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${"b".repeat(32)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account).toBe("bob");
  });

  it("accepts token via query param", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request(`/test?token=${"a".repeat(32)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account).toBe("alice");
  });

  it("rejects invalid query param token", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request("/test?token=wrong");
    expect(res.status).toBe(401);
  });

  it("prefers Authorization header over query param", async () => {
    const app = createTestApp(TEST_ACCOUNTS);
    const res = await app.request(`/test?token=${"b".repeat(32)}`, {
      headers: { Authorization: `Bearer ${"a".repeat(32)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account).toBe("alice");
  });
});
