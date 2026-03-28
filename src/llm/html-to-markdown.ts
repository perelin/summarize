import type { ConvertHtmlToMarkdown } from "../core/content/index.js";
import type { LlmTokenUsage } from "./types.js";
import { generateText, type LiteLlmConnection } from "./generate-text.js";

const MAX_HTML_INPUT_CHARACTERS = 200_000;

function buildHtmlToMarkdownPrompt({
  url,
  title,
  siteName,
  html,
}: {
  url: string;
  title: string | null;
  siteName: string | null;
  html: string;
}): { system: string; prompt: string } {
  const system = `You convert HTML into clean GitHub-Flavored Markdown.

Rules:
- Output ONLY Markdown (no JSON, no explanations, no code fences).
- Keep headings, lists, code blocks, blockquotes.
- Preserve links as Markdown links when possible.
- Remove navigation, cookie banners, footers, and unrelated page chrome.
- Do not invent content.`;

  const prompt = `URL: ${url}
Site: ${siteName ?? "unknown"}
Title: ${title ?? "unknown"}

HTML:
"""
${html}
"""
`;

  return { system, prompt };
}

export function createHtmlToMarkdownConverter({
  modelId,
  connection,
  onUsage,
}: {
  modelId: string;
  connection: LiteLlmConnection;
  onUsage?: (usage: {
    model: string;
    usage: LlmTokenUsage | null;
  }) => void;
}): ConvertHtmlToMarkdown {
  return async ({ url, html, title, siteName, timeoutMs }) => {
    const trimmedHtml =
      html.length > MAX_HTML_INPUT_CHARACTERS ? html.slice(0, MAX_HTML_INPUT_CHARACTERS) : html;
    const { system, prompt } = buildHtmlToMarkdownPrompt({
      url,
      title,
      siteName,
      html: trimmedHtml,
    });

    const result = await generateText({
      modelId,
      connection,
      prompt: { system, userText: prompt },
      timeoutMs,
    });
    onUsage?.({ model: result.modelId, usage: result.usage });
    return result.text;
  };
}
