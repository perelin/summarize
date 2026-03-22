import { describe, expect, it } from "vitest";
import {
  resolveSummaryLength,
  resolveOutputLanguageSetting,
  resolveRunOverrides,
} from "../src/run/run-settings.js";

describe("resolveSummaryLength", () => {
  it("returns xl preset by default when raw is empty", () => {
    const result = resolveSummaryLength("");
    expect(result.lengthArg.kind).toBe("preset");
    if (result.lengthArg.kind === "preset") {
      expect(result.lengthArg.preset).toBe("xl");
    }
  });

  it("uses provided fallback when raw is empty", () => {
    const result = resolveSummaryLength("", "short");
    expect(result.lengthArg.kind).toBe("preset");
    if (result.lengthArg.kind === "preset") {
      expect(result.lengthArg.preset).toBe("short");
    }
  });

  it("parses a preset length value", () => {
    const result = resolveSummaryLength("medium");
    expect(result.lengthArg.kind).toBe("preset");
    if (result.lengthArg.kind === "preset") {
      expect(result.lengthArg.preset).toBe("medium");
    }
  });

  it("handles non-string raw gracefully", () => {
    const result = resolveSummaryLength(42);
    expect(result.lengthArg.kind).toBe("preset");
  });

  it("trims whitespace from input", () => {
    const result = resolveSummaryLength("  short  ");
    expect(result.lengthArg.kind).toBe("preset");
    if (result.lengthArg.kind === "preset") {
      expect(result.lengthArg.preset).toBe("short");
    }
  });
});

describe("resolveOutputLanguageSetting", () => {
  it("returns fallback when raw is empty string", () => {
    const result = resolveOutputLanguageSetting({ raw: "", fallback: { kind: "auto" } });
    expect(result).toEqual({ kind: "auto" });
  });

  it("returns fallback when raw is non-string", () => {
    const result = resolveOutputLanguageSetting({ raw: 123, fallback: { kind: "auto" } });
    expect(result).toEqual({ kind: "auto" });
  });

  it("parses a language tag", () => {
    const result = resolveOutputLanguageSetting({ raw: "en", fallback: { kind: "auto" } });
    expect(result.kind).toBe("fixed");
  });
});

describe("resolveRunOverrides", () => {
  it("returns all nulls when no overrides given", () => {
    const result = resolveRunOverrides({});
    expect(result).toEqual({
      firecrawlMode: null,
      markdownMode: null,
      preprocessMode: null,
      youtubeMode: null,
      videoMode: null,
      transcriptTimestamps: null,
      forceSummary: null,
      timeoutMs: null,
      retries: null,
      maxOutputTokensArg: null,
      transcriber: null,
    });
  });

  it("parses firecrawl mode", () => {
    const result = resolveRunOverrides({ firecrawl: "auto" });
    expect(result.firecrawlMode).toBe("auto");
  });

  it("parses timestamps boolean from string", () => {
    expect(resolveRunOverrides({ timestamps: "true" }).transcriptTimestamps).toBe(true);
    expect(resolveRunOverrides({ timestamps: "false" }).transcriptTimestamps).toBe(false);
    expect(resolveRunOverrides({ timestamps: "yes" }).transcriptTimestamps).toBe(true);
    expect(resolveRunOverrides({ timestamps: "no" }).transcriptTimestamps).toBe(false);
    expect(resolveRunOverrides({ timestamps: "1" }).transcriptTimestamps).toBe(true);
    expect(resolveRunOverrides({ timestamps: "0" }).transcriptTimestamps).toBe(false);
    expect(resolveRunOverrides({ timestamps: "on" }).transcriptTimestamps).toBe(true);
    expect(resolveRunOverrides({ timestamps: "off" }).transcriptTimestamps).toBe(false);
  });

  it("passes through boolean timestamps directly", () => {
    expect(resolveRunOverrides({ timestamps: true }).transcriptTimestamps).toBe(true);
    expect(resolveRunOverrides({ timestamps: false }).transcriptTimestamps).toBe(false);
  });

  it("returns null for unsupported timestamps in non-strict mode", () => {
    expect(resolveRunOverrides({ timestamps: "maybe" }).transcriptTimestamps).toBe(null);
  });

  it("throws for unsupported timestamps in strict mode", () => {
    expect(() =>
      resolveRunOverrides({ timestamps: "maybe" }, { strict: true }),
    ).toThrow("Unsupported --timestamps");
  });

  it("parses numeric timeout directly", () => {
    const result = resolveRunOverrides({ timeout: 5000 });
    expect(result.timeoutMs).toBe(5000);
  });

  it("returns null for non-positive numeric timeout in non-strict mode", () => {
    expect(resolveRunOverrides({ timeout: -1 }).timeoutMs).toBe(null);
    expect(resolveRunOverrides({ timeout: 0 }).timeoutMs).toBe(null);
  });

  it("throws for non-positive numeric timeout in strict mode", () => {
    expect(() => resolveRunOverrides({ timeout: -1 }, { strict: true })).toThrow(
      "--timeout",
    );
  });

  it("parses string timeout via parseDurationMs", () => {
    const result = resolveRunOverrides({ timeout: "30s" });
    expect(result.timeoutMs).toBe(30_000);
  });

  it("parses forceSummary boolean", () => {
    expect(resolveRunOverrides({ forceSummary: "true" }).forceSummary).toBe(true);
    expect(resolveRunOverrides({ forceSummary: false }).forceSummary).toBe(false);
  });

  it("parses transcriber override", () => {
    expect(resolveRunOverrides({ transcriber: "whisper" }).transcriber).toBe("whisper");
    expect(resolveRunOverrides({ transcriber: "parakeet" }).transcriber).toBe("parakeet");
    expect(resolveRunOverrides({ transcriber: "canary" }).transcriber).toBe("canary");
    expect(resolveRunOverrides({ transcriber: "auto" }).transcriber).toBe("auto");
  });

  it("normalizes transcriber case", () => {
    expect(resolveRunOverrides({ transcriber: "WHISPER" }).transcriber).toBe("whisper");
    expect(resolveRunOverrides({ transcriber: " Auto " }).transcriber).toBe("auto");
  });

  it("returns null for unknown transcriber in non-strict mode", () => {
    expect(resolveRunOverrides({ transcriber: "unknown" }).transcriber).toBe(null);
  });

  it("throws for unknown transcriber in strict mode", () => {
    expect(() =>
      resolveRunOverrides({ transcriber: "unknown" }, { strict: true }),
    ).toThrow("Unsupported transcriber");
  });

  it("parses youtube mode", () => {
    const result = resolveRunOverrides({ youtube: "auto" });
    expect(result.youtubeMode).toBe("auto");
  });
});
