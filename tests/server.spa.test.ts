import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/index.js";

function createTestApp() {
  return createApp({
    accounts: [{ name: "test", token: "t".repeat(32) }],
    env: {},
    config: null,
    cache: {
      mode: "bypass",
      store: null,
      ttlMs: 0,
      maxBytes: 0,
      path: null,
    } as any,
    mediaCache: null,
  });
}

describe("SPA catch-all route", () => {
  it("/s/abc-123-def returns HTML or 'Frontend not built', not 404", async () => {
    const app = createTestApp();
    const res = await app.request("/s/abc-123-def");
    expect(res.status).not.toBe(404);
    const text = await res.text();
    // Should be HTML content or the "Frontend not built" fallback
    expect(
      text.includes("<!DOCTYPE html") ||
        text.includes("<!doctype html") ||
        text.includes("Frontend not built"),
    ).toBe(true);
  });

  it("/history returns HTML or 'Frontend not built', not 404", async () => {
    const app = createTestApp();
    const res = await app.request("/history");
    expect(res.status).not.toBe(404);
    const text = await res.text();
    expect(
      text.includes("<!DOCTYPE html") ||
        text.includes("<!doctype html") ||
        text.includes("Frontend not built"),
    ).toBe(true);
  });

  it("/v1/health still returns 200 with JSON", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("/assets/nonexistent.js still returns 404", async () => {
    const app = createTestApp();
    const res = await app.request("/assets/nonexistent.js");
    expect(res.status).toBe(404);
  });
});
