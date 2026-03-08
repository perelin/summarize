import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createSummarizeRoute } from "../src/server/routes/summarize.js";

const fakeDeps = {
  env: {},
  config: null,
  cache: { mode: "bypass", store: null, ttlMs: 0, maxBytes: 0, path: null } as any,
  mediaCache: null,
};

function createTestApp() {
  const app = new Hono();
  const route = createSummarizeRoute(fakeDeps);
  app.route("/v1", route);
  return app;
}

describe("POST /v1/summarize – input validation", () => {
  it("rejects empty JSON body with 400 INVALID_INPUT", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects invalid length with 400", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", length: "bogus" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("Invalid length");
  });

  it("rejects non-http URL (ftp://) with 400", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "ftp://example.com/file" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects invalid JSON with 400", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });
});
