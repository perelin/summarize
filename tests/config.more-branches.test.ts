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
  it("rejects model.id without a provider prefix", () => {
    const root = writeJsonConfig({ model: { id: "gpt-5.2" } });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /must be provider-prefixed/i,
    );
  });

  it('rejects model.name "auto" in object form', () => {
    const root = writeJsonConfig({ model: { name: "auto" } });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /must not be "auto"/i,
    );
  });

  it("rejects invalid models keys (duplicates, spaces, slashes)", () => {
    const rootDup = writeJsonConfig({
      models: { Fast: { id: "openai/gpt-5.2" }, fast: { id: "openai/gpt-5.2" } },
    });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: rootDup } })).toThrow(
      /duplicate model name/i,
    );

    const rootSpace = writeJsonConfig({ models: { "my preset": { id: "openai/gpt-5.2" } } });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: rootSpace } })).toThrow(
      /must not contain spaces/i,
    );

    const rootSlash = writeJsonConfig({ models: { "a/b": { id: "openai/gpt-5.2" } } });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: rootSlash } })).toThrow(
      /must not include/i,
    );
  });

  it("rejects models entries that reference another model by name", () => {
    const root = writeJsonConfig({ models: { fast: { name: "other" } } });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /must not reference another model/i,
    );
  });

  it("rejects non-object openai config", () => {
    const root = writeJsonConfig({ openai: 1 });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /"openai" must be an object/i,
    );
  });

  it("rejects non-object output config", () => {
    const root = writeJsonConfig({ output: 1 });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /"output" must be an object/i,
    );
  });
});
