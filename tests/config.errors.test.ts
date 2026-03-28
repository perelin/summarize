import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSummarizeConfig } from "../src/config.js";

describe("config error handling", () => {
  it("throws on invalid JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-config-"));
    const configPath = join(root, "config.json");
    writeFileSync(configPath, "{not json", "utf8");

    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /Invalid JSON in config file/,
    );
  });

  it("throws when config contains comments", () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-config-"));
    const configPath = join(root, "config.json");
    writeFileSync(
      configPath,
      '{\n  // no comments\n  "model": "openai/gpt-5.2"\n}\n',
      "utf8",
    );

    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /comments are not allowed/i,
    );
  });

  it("throws when top-level is not an object", () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-config-"));
    const configPath = join(root, "config.json");
    writeFileSync(configPath, JSON.stringify(["nope"]), "utf8");

    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /expected an object/,
    );
  });

  it("throws when model is empty", () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-config-"));
    const configPath = join(root, "config.json");
    writeFileSync(configPath, JSON.stringify({ model: "   " }), "utf8");

    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /"model" must not be empty/i,
    );
  });

  it("ignores unexpected top-level keys", () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-config-"));
    const configPath = join(root, "config.json");
    writeFileSync(configPath, JSON.stringify({ model: "openai/gpt-5.2", auto: [] }), "utf8");

    const loaded = loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } });
    expect(loaded.config?.model).toBe("openai/gpt-5.2");
  });

  it("throws when model is not a string", () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-config-"));
    const configPath = join(root, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ model: { mode: "auto", rules: { nope: true } } }),
      "utf8",
    );

    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /"model" must be a string/i,
    );
  });
});
