import { describe, expect, it } from "vitest";
import {
  formatModelLabelForDisplay,
  buildExtractFinishLabel,
  buildSummaryFinishLabel,
  buildLengthPartsForFinishLine,
  buildFinishLineModel,
  formatFinishLineText,
} from "../src/run/finish-line.js";

describe("formatModelLabelForDisplay", () => {
  it("returns empty string for empty input", () => {
    expect(formatModelLabelForDisplay("")).toBe("");
  });

  it("returns model as-is for normal models", () => {
    expect(formatModelLabelForDisplay("claude-3-sonnet")).toBe("claude-3-sonnet");
  });

  it("strips openai/ prefix from OpenRouter-routed models", () => {
    expect(formatModelLabelForDisplay("openai/anthropic/claude-3-sonnet")).toBe(
      "anthropic/claude-3-sonnet",
    );
  });

  it("keeps two-part paths untouched", () => {
    expect(formatModelLabelForDisplay("anthropic/claude-3-sonnet")).toBe(
      "anthropic/claude-3-sonnet",
    );
  });

  it("trims whitespace", () => {
    expect(formatModelLabelForDisplay("  gpt-4  ")).toBe("gpt-4");
  });
});

describe("buildExtractFinishLabel", () => {
  const baseDiagnostics = {
    strategy: "html" as const,
    firecrawl: { used: false },
    markdown: { used: false, provider: null as "firecrawl" | "llm" | null },
    transcript: { textProvided: false, provider: null },
  };

  it("returns 'text' for text format with no special strategy", () => {
    const result = buildExtractFinishLabel({
      extracted: { diagnostics: baseDiagnostics },
      format: "text",
      markdownMode: "off",
      hasMarkdownLlmCall: false,
    });
    expect(result).toBe("text");
  });

  it("returns transcript label when transcript provided", () => {
    const result = buildExtractFinishLabel({
      extracted: {
        diagnostics: {
          ...baseDiagnostics,
          transcript: { textProvided: true, provider: "youtube-captions" },
        },
      },
      format: "text",
      markdownMode: "off",
      hasMarkdownLlmCall: false,
    });
    expect(result).toBe("text via transcript/youtube-captions");
  });

  it("returns firecrawl label when firecrawl strategy used", () => {
    const result = buildExtractFinishLabel({
      extracted: {
        diagnostics: { ...baseDiagnostics, strategy: "firecrawl" as const },
      },
      format: "text",
      markdownMode: "off",
      hasMarkdownLlmCall: false,
    });
    expect(result).toBe("text via firecrawl");
  });

  it("returns markdown via firecrawl for markdown format with firecrawl", () => {
    const result = buildExtractFinishLabel({
      extracted: {
        diagnostics: { ...baseDiagnostics, strategy: "firecrawl" as const },
      },
      format: "markdown",
      markdownMode: "auto",
      hasMarkdownLlmCall: false,
    });
    expect(result).toBe("markdown via firecrawl");
  });

  it("returns markdown via readability for readability mode on html strategy", () => {
    const result = buildExtractFinishLabel({
      extracted: { diagnostics: baseDiagnostics },
      format: "markdown",
      markdownMode: "readability",
      hasMarkdownLlmCall: false,
    });
    expect(result).toBe("markdown via readability");
  });

  it("returns markdown via llm when markdown used with LLM call", () => {
    const result = buildExtractFinishLabel({
      extracted: {
        diagnostics: {
          ...baseDiagnostics,
          markdown: { used: true, provider: "llm" as const },
        },
      },
      format: "markdown",
      markdownMode: "auto",
      hasMarkdownLlmCall: true,
    });
    expect(result).toBe("markdown via llm");
  });

  it("returns text via xurl for xurl strategy", () => {
    const result = buildExtractFinishLabel({
      extracted: {
        diagnostics: { ...baseDiagnostics, strategy: "xurl" as const },
      },
      format: "text",
      markdownMode: "off",
      hasMarkdownLlmCall: false,
    });
    expect(result).toBe("text via xurl");
  });

  it("returns text via bird for bird strategy", () => {
    const result = buildExtractFinishLabel({
      extracted: {
        diagnostics: { ...baseDiagnostics, strategy: "bird" as const },
      },
      format: "text",
      markdownMode: "off",
      hasMarkdownLlmCall: false,
    });
    expect(result).toBe("text via bird");
  });

  it("returns text via nitter for nitter strategy", () => {
    const result = buildExtractFinishLabel({
      extracted: {
        diagnostics: { ...baseDiagnostics, strategy: "nitter" as const },
      },
      format: "text",
      markdownMode: "off",
      hasMarkdownLlmCall: false,
    });
    expect(result).toBe("text via nitter");
  });
});

describe("buildSummaryFinishLabel", () => {
  const baseDiagnostics = {
    strategy: "html",
    firecrawl: { used: false },
    markdown: { used: false, provider: null as "firecrawl" | "llm" | null },
    transcript: { textProvided: false, provider: null },
  };

  it("returns word count for non-transcript html strategy", () => {
    const result = buildSummaryFinishLabel({
      extracted: {
        diagnostics: baseDiagnostics,
        wordCount: 1500,
      },
    });
    expect(result).toBe("1.5k words");
  });

  it("returns null for transcript with no special sources", () => {
    const result = buildSummaryFinishLabel({
      extracted: {
        diagnostics: {
          ...baseDiagnostics,
          transcript: { textProvided: true, provider: null },
        },
        wordCount: 1500,
      },
    });
    expect(result).toBe(null);
  });

  it("returns via source for transcript with firecrawl", () => {
    const result = buildSummaryFinishLabel({
      extracted: {
        diagnostics: {
          ...baseDiagnostics,
          strategy: "firecrawl",
          firecrawl: { used: true },
          transcript: { textProvided: true, provider: null },
        },
        wordCount: 1500,
      },
    });
    expect(result).toBe("via firecrawl");
  });

  it("returns words via source for non-transcript with firecrawl", () => {
    const result = buildSummaryFinishLabel({
      extracted: {
        diagnostics: {
          ...baseDiagnostics,
          firecrawl: { used: true },
        },
        wordCount: 2000,
      },
    });
    expect(result).toBe("2.0k words via firecrawl");
  });

  it("returns null when no sources and zero words", () => {
    const result = buildSummaryFinishLabel({
      extracted: {
        diagnostics: baseDiagnostics,
        wordCount: 0,
      },
    });
    expect(result).toBe(null);
  });
});

describe("buildLengthPartsForFinishLine", () => {
  const baseExtracted = {
    url: "https://example.com",
    siteName: null,
    totalCharacters: 10000,
    wordCount: 1500,
    transcriptCharacters: null,
    transcriptLines: null,
    transcriptWordCount: null,
    transcriptSource: null,
    transcriptionProvider: null,
    mediaDurationSeconds: null,
    video: null,
    isVideoOnly: false,
    diagnostics: { transcript: { cacheStatus: "unknown" } },
  };

  it("returns null in compact mode for non-transcript content", () => {
    const result = buildLengthPartsForFinishLine(baseExtracted, false);
    expect(result).toBe(null);
  });

  it("returns transcript info in compact mode for YouTube content", () => {
    const result = buildLengthPartsForFinishLine(
      {
        ...baseExtracted,
        url: "https://youtube.com/watch?v=123",
        siteName: "YouTube",
        transcriptCharacters: 6000,
        transcriptWordCount: 1000,
        mediaDurationSeconds: 600,
      },
      false,
    );
    expect(result).not.toBe(null);
    expect(result![0]).toContain("txc=");
    expect(result![0]).toContain("YouTube");
  });

  it("returns detailed parts for transcript content", () => {
    const result = buildLengthPartsForFinishLine(
      {
        ...baseExtracted,
        url: "https://youtube.com/watch?v=123",
        siteName: "YouTube",
        transcriptCharacters: 6000,
        transcriptWordCount: 1000,
        transcriptSource: "youtube-captions",
        mediaDurationSeconds: 600,
      },
      true,
    );
    expect(result).not.toBe(null);
    expect(result!.some((p) => p.includes("transcript="))).toBe(true);
    expect(result!.some((p) => p.includes("tx=youtube-captions"))).toBe(true);
  });
});

describe("buildFinishLineModel + formatFinishLineText", () => {
  const baseReport = {
    llm: [{ promptTokens: 1000, completionTokens: 200, totalTokens: 1200, calls: 1 }],
    services: { firecrawl: { requests: 0 }, apify: { requests: 0 } },
  };

  it("produces a compact line with elapsed time, model, and tokens", () => {
    const model = buildFinishLineModel({
      elapsedMs: 5000,
      model: "claude-3-sonnet",
      report: baseReport,
      costUsd: null,
    });
    const text = formatFinishLineText(model, false);
    expect(text.line).toContain("5.0s");
    expect(text.line).toContain("claude-3-sonnet");
    expect(text.details).toBe(null);
  });

  it("includes cost when provided", () => {
    const model = buildFinishLineModel({
      elapsedMs: 5000,
      model: "claude-3-sonnet",
      report: baseReport,
      costUsd: 0.005,
    });
    const text = formatFinishLineText(model, false);
    expect(text.line).toContain("$0.005");
  });

  it("includes service details in detailed mode", () => {
    const model = buildFinishLineModel({
      elapsedMs: 5000,
      model: "claude-3-sonnet",
      report: {
        llm: [{ promptTokens: 1000, completionTokens: 200, totalTokens: 1200, calls: 3 }],
        services: { firecrawl: { requests: 2 }, apify: { requests: 0 } },
      },
      costUsd: null,
    });
    const text = formatFinishLineText(model, true);
    expect(text.details).toContain("firecrawl=");
    expect(text.details).toContain("calls=");
  });

  it("uses custom label", () => {
    const model = buildFinishLineModel({
      elapsedMs: 5000,
      label: "2.5k words via firecrawl",
      model: null,
      report: baseReport,
      costUsd: null,
    });
    const text = formatFinishLineText(model, false);
    expect(text.line).toContain("via firecrawl");
  });
});
