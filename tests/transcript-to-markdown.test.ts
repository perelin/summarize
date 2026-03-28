import { describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn(async () => ({
  text: "# Formatted Transcript\n\nThis is a well-structured transcript.",
  modelId: "openai/gpt-5.2",
  usage: null,
}));

vi.mock("../src/llm/generate-text.js", () => ({
  generateText: generateTextMock,
}));

describe("Transcript→Markdown converter", async () => {
  const { createTranscriptToMarkdownConverter } =
    await import("../src/llm/transcript-to-markdown.js");

  it("passes system + prompt to generateText", async () => {
    generateTextMock.mockClear();

    const converter = createTranscriptToMarkdownConverter({
      modelId: "openai/gpt-5.2",
      connection: { baseUrl: "http://localhost:4000", apiKey: null },
    });

    const result = await converter({
      title: "How to Speak",
      source: "YouTube",
      transcript: "SPEAKER: Hello everyone. Um, today we will talk about speaking.",
      timeoutMs: 2000,
    });

    expect(result).toBe("# Formatted Transcript\n\nThis is a well-structured transcript.");
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const args = generateTextMock.mock.calls[0]?.[0] as {
      prompt: { system?: string; userText: string };
      modelId: string;
    };
    expect(args.modelId).toBe("openai/gpt-5.2");
    expect(args.prompt.system).toContain("You convert raw transcripts");
    expect(args.prompt.system).toContain("filler words");
    expect(args.prompt.userText).toContain("Title: How to Speak");
    expect(args.prompt.userText).toContain("Source: YouTube");
    expect(args.prompt.userText).toContain("Hello everyone");
  });

  it("handles null title and source gracefully", async () => {
    generateTextMock.mockClear();

    const converter = createTranscriptToMarkdownConverter({
      modelId: "openai/gpt-5.2",
      connection: { baseUrl: "http://localhost:4000", apiKey: null },
    });

    await converter({
      title: null,
      source: null,
      transcript: "Some transcript content",
      timeoutMs: 2000,
    });

    const args = generateTextMock.mock.calls[0]?.[0] as {
      prompt: { userText: string };
    };
    expect(args.prompt.userText).toContain("Title: unknown");
    expect(args.prompt.userText).toContain("Source: unknown");
  });

  it("includes output language instructions when provided", async () => {
    generateTextMock.mockClear();

    const converter = createTranscriptToMarkdownConverter({
      modelId: "openai/gpt-5.2",
      connection: { baseUrl: "http://localhost:4000", apiKey: null },
    });

    await converter({
      title: "Test",
      source: "YouTube",
      transcript: "Bonjour le monde.",
      timeoutMs: 2000,
      outputLanguage: { kind: "fixed", tag: "fr", label: "French" },
    });

    const args = generateTextMock.mock.calls[0]?.[0] as {
      prompt: { system?: string };
    };
    expect(args.prompt.system).toContain("Write the answer in French.");
  });

  it("truncates very large transcript inputs", async () => {
    generateTextMock.mockClear();

    const converter = createTranscriptToMarkdownConverter({
      modelId: "openai/gpt-5.2",
      connection: { baseUrl: "http://localhost:4000", apiKey: null },
    });

    const transcript = `${"A".repeat(200_005)}MARKER`;
    await converter({
      title: "Test",
      source: "Test",
      transcript,
      timeoutMs: 2000,
    });

    const args = generateTextMock.mock.calls[0]?.[0] as {
      prompt: { userText: string };
    };
    expect(args.prompt.userText).not.toContain("MARKER");
  });

  it("calls onUsage callback with model info", async () => {
    generateTextMock.mockClear();

    const onUsageMock = vi.fn();

    const converter = createTranscriptToMarkdownConverter({
      modelId: "openai/gpt-5.2",
      connection: { baseUrl: "http://localhost:4000", apiKey: null },
      onUsage: onUsageMock,
    });

    await converter({
      title: "Test",
      source: "Test",
      transcript: "Test transcript",
      timeoutMs: 2000,
    });

    expect(onUsageMock).toHaveBeenCalledTimes(1);
    expect(onUsageMock).toHaveBeenCalledWith({
      model: "openai/gpt-5.2",
      usage: null,
    });
  });

  it("works with any model via connection", async () => {
    generateTextMock.mockClear();

    const converter = createTranscriptToMarkdownConverter({
      modelId: "anthropic/claude-3-haiku",
      connection: { baseUrl: "http://localhost:4000", apiKey: "sk-test" },
    });

    await converter({
      title: "Test",
      source: "Test",
      transcript: "Test transcript",
      timeoutMs: 2000,
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const args = generateTextMock.mock.calls[0]?.[0] as {
      modelId: string;
    };
    expect(args.modelId).toBe("anthropic/claude-3-haiku");
  });
});
