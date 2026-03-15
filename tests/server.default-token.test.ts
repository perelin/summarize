import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Account } from "../src/config/types.js";
import { createDefaultTokenRoute } from "../src/server/routes/default-token.js";

const ANON_TOKEN = "a".repeat(32);

describe("GET /v1/default-token", () => {
  it("returns anonymous token when anonymous account exists", async () => {
    const accounts: Account[] = [
      { name: "perelin", token: "p".repeat(32) },
      { name: "anonymous", token: ANON_TOKEN },
    ];
    const app = new Hono();
    app.route("/v1", createDefaultTokenRoute(accounts));
    const res = await app.request("/v1/default-token");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: ANON_TOKEN, account: "anonymous" });
  });

  it("returns 404 when no anonymous account exists", async () => {
    const accounts: Account[] = [{ name: "perelin", token: "p".repeat(32) }];
    const app = new Hono();
    app.route("/v1", createDefaultTokenRoute(accounts));
    const res = await app.request("/v1/default-token");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when accounts array is empty", async () => {
    const app = new Hono();
    app.route("/v1", createDefaultTokenRoute([]));
    const res = await app.request("/v1/default-token");
    expect(res.status).toBe(404);
  });
});
