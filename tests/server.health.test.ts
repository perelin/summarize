import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { healthRoute } from "../src/server/routes/health.js";

describe("GET /v1/health", () => {
  it("returns ok", async () => {
    const app = new Hono();
    app.route("/v1", healthRoute);
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
