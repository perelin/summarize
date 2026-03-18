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

  it("/manifest.webmanifest returns correct content-type, not HTML", async () => {
    const app = createTestApp();
    const res = await app.request("/manifest.webmanifest");
    // Should either serve the file (if built) or 404/503 — never HTML
    const contentType = res.headers.get("content-type") ?? "";
    if (res.status === 200) {
      expect(contentType).toContain("application/manifest+json");
    }
    // Must not return the SPA shell
    const text = await res.text();
    expect(text).not.toContain("<!doctype html");
  });

  it("/sw.js returns correct content-type, not HTML", async () => {
    const app = createTestApp();
    const res = await app.request("/sw.js");
    const contentType = res.headers.get("content-type") ?? "";
    if (res.status === 200) {
      expect(contentType).toContain("application/javascript");
    }
    const text = await res.text();
    expect(text).not.toContain("<!doctype html");
  });

  it("/pwa-192x192.png returns correct content-type, not HTML", async () => {
    const app = createTestApp();
    const res = await app.request("/pwa-192x192.png");
    const contentType = res.headers.get("content-type") ?? "";
    if (res.status === 200) {
      expect(contentType).toContain("image/png");
    }
    const text = await res.text();
    expect(text).not.toContain("<!doctype html");
  });

  it("path traversal attempt does not serve files outside publicDir", async () => {
    const app = createTestApp();
    const res = await app.request("/../package.json");
    const text = await res.text();
    // Must not leak file contents from outside publicDir
    expect(text).not.toContain('"@steipete/summarize');
  });
});
