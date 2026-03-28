import { describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn(async () => ({
  text: "# Hello",
  modelId: "openai/gpt-5.2",
  usage: null,
}));

vi.mock("../src/llm/generate-text.js", () => ({
  generateText: generateTextMock,
}));

describe("HTML→Markdown converter", async () => {
  const { createHtmlToMarkdownConverter } = await import("../src/llm/html-to-markdown.js");

  it("passes system + prompt to generateText", async () => {
    generateTextMock.mockClear();

    const converter = createHtmlToMarkdownConverter({
      modelId: "openai/gpt-5.2",
      connection: { baseUrl: "http://localhost:4000", apiKey: null },
    });

    const result = await converter({
      url: "https://example.com",
      title: "Example",
      siteName: "Example",
      html: "<html><body><h1>Hello</h1></body></html>",
      timeoutMs: 2000,
    });

    expect(result).toBe("# Hello");
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const args = generateTextMock.mock.calls[0]?.[0] as {
      prompt: { system?: string; userText: string };
      modelId: string;
    };
    expect(args.modelId).toBe("openai/gpt-5.2");
    expect(args.prompt.system).toContain("You convert HTML");
    expect(args.prompt.userText).toContain("URL: https://example.com");
    expect(args.prompt.userText).toContain("<h1>Hello</h1>");
  });

  it("truncates very large HTML inputs", async () => {
    generateTextMock.mockClear();

    const converter = createHtmlToMarkdownConverter({
      modelId: "openai/gpt-5.2",
      connection: { baseUrl: "http://localhost:4000", apiKey: null },
    });

    const html = `<html><body>${"A".repeat(200_005)}MARKER</body></html>`;
    await converter({
      url: "https://example.com",
      title: null,
      siteName: null,
      html,
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

    const converter = createHtmlToMarkdownConverter({
      modelId: "openai/gpt-5.2",
      connection: { baseUrl: "http://localhost:4000", apiKey: null },
      onUsage: onUsageMock,
    });

    await converter({
      url: "https://example.com",
      title: "Example",
      siteName: "Example",
      html: "<html><body><h1>Hello</h1></body></html>",
      timeoutMs: 2000,
    });

    expect(onUsageMock).toHaveBeenCalledTimes(1);
    expect(onUsageMock).toHaveBeenCalledWith({
      model: "openai/gpt-5.2",
      usage: null,
    });
  });
});
