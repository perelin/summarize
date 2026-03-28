import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSummarizeConfig } from "../src/config.js";

const writeJsonConfig = (value: unknown) => {
  const root = mkdtempSync(join(tmpdir(), "summarize-config-more-"));
  writeFileSync(join(root, "config.json"), JSON.stringify(value), "utf8");
  return root;
};

describe("config extra branches", () => {
  it("rejects non-object output config", () => {
    const root = writeJsonConfig({ output: 1 });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /"output" must be an object/i,
    );
  });

  it("rejects non-string model config", () => {
    const root = writeJsonConfig({ model: 42 });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /"model" must be a string/i,
    );
  });

  it("accepts model as a simple string", () => {
    const root = writeJsonConfig({ model: "openai/gpt-5.2" });
    const result = loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } });
    expect(result.config?.model).toBe("openai/gpt-5.2");
  });

  it("accepts litellm config section", () => {
    const root = writeJsonConfig({
      litellm: { baseUrl: "http://localhost:4000" },
    });
    const result = loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } });
    expect(result.config?.litellm?.baseUrl).toBe("http://localhost:4000");
  });
});
