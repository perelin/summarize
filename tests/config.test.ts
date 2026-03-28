import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSummarizeConfig } from "../src/config.js";

const writeConfig = (raw: string) => {
  const root = mkdtempSync(join(tmpdir(), "summarize-config-"));
  const configPath = join(root, "config.json");
  writeFileSync(configPath, raw, "utf8");
  return { root, configPath };
};

const writeJsonConfig = (value: unknown) => writeConfig(JSON.stringify(value));

describe("config loading", () => {
  it("loads config.json from SUMMARIZE_DATA_DIR", () => {
    const { root, configPath } = writeJsonConfig({ model: "openai/gpt-5.2" });

    const result = loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } });
    expect(result.path).toBe(configPath);
    expect(result.config).toEqual({ model: "openai/gpt-5.2" });
  });

  it("supports output.language", () => {
    const { root } = writeJsonConfig({
      model: "openai/gpt-5-mini",
      output: { language: "de" },
    });

    const result = loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } });
    expect(result.config).toEqual({
      model: "openai/gpt-5-mini",
      output: { language: "de" },
    });
  });

  it("accepts apify and firecrawl legacy apiKeys", () => {
    const { root } = writeJsonConfig({
      apiKeys: {
        apify: "apify-test",
        firecrawl: "fc-test",
      },
    });

    const result = loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } });
    expect(result.config?.apiKeys).toEqual({
      apify: "apify-test",
      firecrawl: "fc-test",
    });
  });

  it("supports model as a simple string", () => {
    const { root } = writeJsonConfig({ model: "mistral/mistral-large-latest" });
    const result = loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } });
    expect(result.config).toEqual({ model: "mistral/mistral-large-latest" });
  });

  it("returns null config when no config file exists", () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-config-"));
    const result = loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } });
    expect(result.config).toBeNull();
    expect(result.path).toBeNull();
  });

  it("rejects JSON with line comments", () => {
    const { root } = writeConfig(`{\n// nope\n"model": "auto"\n}`);
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /comments are not allowed/,
    );
  });

  it("rejects JSON with block comments", () => {
    const { root } = writeConfig(`/* nope */\n{"model": "auto"}`);
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /comments are not allowed/,
    );
  });

  it("allows comment markers inside strings", () => {
    const { root } = writeConfig(`{"model": "openai/gpt-5.2", "url": "http://x"}`);
    expect(loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } }).config).toEqual({
      model: "openai/gpt-5.2",
    });
  });

  it("rejects invalid JSON", () => {
    const { root } = writeConfig("{");
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /Invalid JSON/,
    );
  });

  it("rejects non-object top-level JSON", () => {
    const { root } = writeConfig("[]");
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /expected an object/,
    );
  });

  it("rejects empty model string", () => {
    const { root } = writeJsonConfig({ model: "   " });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /model.*must not be empty/,
    );
  });

  it("rejects non-string model config", () => {
    const { root } = writeJsonConfig({ model: 42 });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /model.*must be a string/,
    );
  });

  it("rejects object model config", () => {
    const { root } = writeJsonConfig({ model: { id: "openai/gpt-5.2" } });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /model.*must be a string/,
    );
  });

  it("parses cache config", () => {
    const { root } = writeJsonConfig({
      cache: {
        enabled: false,
        maxMb: 256,
        ttlDays: 14,
        path: "/tmp/summarize-cache.sqlite",
      },
    });
    expect(loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } }).config).toEqual({
      cache: {
        enabled: false,
        maxMb: 256,
        ttlDays: 14,
        path: "/tmp/summarize-cache.sqlite",
      },
    });
  });

  it("parses cache media config", () => {
    const { root } = writeJsonConfig({
      cache: {
        media: {
          enabled: true,
          maxMb: 512,
          ttlDays: 3,
          path: "/tmp/summarize-media",
          verify: "hash",
        },
      },
    });
    expect(loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } }).config).toEqual({
      cache: {
        media: {
          enabled: true,
          maxMb: 512,
          ttlDays: 3,
          path: "/tmp/summarize-media",
          verify: "hash",
        },
      },
    });
  });

  it("rejects invalid cache media settings", () => {
    const { root: badMedia } = writeJsonConfig({ cache: { media: "nope" } });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: badMedia } })).toThrow(
      /cache\.media/,
    );

    const { root: badMax } = writeJsonConfig({ cache: { media: { maxMb: "nope" } } });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: badMax } })).toThrow(
      /cache\.media\.maxMb/,
    );

    const { root: badTtl } = writeJsonConfig({ cache: { media: { ttlDays: "nope" } } });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: badTtl } })).toThrow(
      /cache\.media\.ttlDays/,
    );

    const { root: badPath } = writeJsonConfig({ cache: { media: { path: 123 } } });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: badPath } })).toThrow(
      /cache\.media\.path/,
    );

    const { root: badVerify } = writeJsonConfig({ cache: { media: { verify: "nope" } } });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: badVerify } })).toThrow(
      /cache\.media\.verify/,
    );
  });

  it("parses litellm config", () => {
    const { root } = writeJsonConfig({
      model: "mistral/mistral-large-latest",
      litellm: { baseUrl: "http://10.10.10.10:4000", apiKey: "sk-test" },
    });
    const result = loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } });
    expect(result.config).toEqual({
      model: "mistral/mistral-large-latest",
      litellm: { baseUrl: "http://10.10.10.10:4000", apiKey: "sk-test" },
    });
  });

  it("parses sttModel config", () => {
    const { root } = writeJsonConfig({
      model: "mistral/mistral-large-latest",
      sttModel: "mistral/voxtral-mini-latest",
    });
    const result = loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } });
    expect(result.config).toEqual({
      model: "mistral/mistral-large-latest",
      sttModel: "mistral/voxtral-mini-latest",
    });
  });

  it("ignores unexpected top-level keys", () => {
    const { root } = writeConfig(`{"model": "openai/gpt-5.2", "unknown": "ignored"}`);
    expect(loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } }).config).toEqual({
      model: "openai/gpt-5.2",
    });
  });

  it("rejects unknown apiKeys providers", () => {
    const { root } = writeJsonConfig({
      apiKeys: { openai: "sk-test" },
    });
    expect(() => loadSummarizeConfig({ env: { SUMMARIZE_DATA_DIR: root } })).toThrow(
      /unknown apiKeys provider/i,
    );
  });
});
