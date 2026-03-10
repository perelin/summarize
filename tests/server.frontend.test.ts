import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/index.js";

const deps = {
  env: {},
  config: null,
  cache: { get: async () => null, set: async () => {} } as any,
  mediaCache: null,
  apiToken: "test-token",
};

describe("GET /", () => {
  it("serves HTML without authentication", async () => {
    const app = createApp(deps);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("contains the page title", async () => {
    const app = createApp(deps);
    const res = await app.request("/");
    const body = await res.text();
    expect(body).toContain("<title>");
    expect(body).toContain("Summarize");
  });
});

describe("GET / — UI elements", () => {
  it("includes the URL input", async () => {
    const app = createApp(deps);
    const res = await app.request("/");
    const body = await res.text();
    expect(body).toContain('id="url-input"');
  });

  it("includes the text input", async () => {
    const app = createApp(deps);
    const res = await app.request("/");
    const body = await res.text();
    expect(body).toContain('id="text-input"');
  });

  it("includes the length selector", async () => {
    const app = createApp(deps);
    const res = await app.request("/");
    const body = await res.text();
    expect(body).toContain('id="length-select"');
  });

  it("includes the marked.js CDN script", async () => {
    const app = createApp(deps);
    const res = await app.request("/");
    const body = await res.text();
    expect(body).toContain("marked");
  });
});
