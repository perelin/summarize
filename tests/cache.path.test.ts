import { join, resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCachePath } from "../src/cache.js";

describe("resolveCachePath", () => {
  it("uses SUMMARIZE_DATA_DIR for default path", () => {
    const dataDir = "/tmp/summarize-data";
    const resolved = resolveCachePath({ env: { SUMMARIZE_DATA_DIR: dataDir }, cachePath: null });
    expect(resolved).toBe(join(dataDir, "cache.sqlite"));
  });

  it("expands tilde paths using HOME", () => {
    const home = "/tmp/summarize-home";
    const tilde = resolveCachePath({ env: { HOME: home }, cachePath: "~/cache.sqlite" });
    expect(tilde).toBe(resolvePath(join(home, "cache.sqlite")));
  });

  it("resolves relative paths from cwd", () => {
    const relative = resolveCachePath({ env: {}, cachePath: "cache.sqlite" });
    expect(relative).toBe(resolvePath("cache.sqlite"));
  });

  it("returns null when no data dir is set and no explicit path", () => {
    expect(resolveCachePath({ env: {}, cachePath: null })).toBeNull();
  });

  it("accepts absolute paths without HOME", () => {
    const absolute = "/tmp/summarize-cache.sqlite";
    expect(resolveCachePath({ env: {}, cachePath: absolute })).toBe(absolute);
  });
});
