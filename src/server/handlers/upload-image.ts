/**
 * Image upload handler: describes an uploaded image using a vision-capable LLM.
 *
 * The returned text is a detailed description of the image contents — including
 * any visible text, data, tables, charts, or numbers — which can then be fed
 * into the summarization pipeline as plain text.
 */
import {
  streamTextWithModelId,
  type LlmApiKeys,
} from "../../llm/generate-text.js";
import type { Prompt } from "../../llm/prompt.js";

export async function describeImage(
  file: { name: string; type: string; bytes: Uint8Array },
  options: {
    env: Record<string, string | undefined>;
    modelOverride: string | null;
    fetchImpl: typeof fetch;
  },
): Promise<{ text: string; modelId: string }> {
  const prompt: Prompt = {
    system:
      "You are analyzing an uploaded image. Describe it in detail. Extract any visible text, data, tables, charts, or numbers. Format as plain text.",
    userText: `Describe and extract all content from this image: ${file.name}`,
    attachments: [
      {
        kind: "image",
        mediaType: file.type || "image/png",
        bytes: file.bytes,
        filename: file.name,
      },
    ],
  };

  const modelId =
    options.modelOverride ??
    options.env.SUMMARIZE_DEFAULT_MODEL ??
    "anthropic/claude-sonnet-4-20250514";

  const apiKeys: LlmApiKeys = {
    xaiApiKey: options.env.XAI_API_KEY ?? null,
    openaiApiKey: options.env.OPENAI_API_KEY ?? null,
    googleApiKey:
      options.env.GEMINI_API_KEY ??
      options.env.GOOGLE_GENERATIVE_AI_API_KEY ??
      options.env.GOOGLE_API_KEY ??
      null,
    anthropicApiKey: options.env.ANTHROPIC_API_KEY ?? null,
    openrouterApiKey: options.env.OPENROUTER_API_KEY ?? null,
  };

  const result = await streamTextWithModelId({
    modelId,
    apiKeys,
    prompt,
    temperature: 0,
    maxOutputTokens: 4096,
    timeoutMs: 120_000,
    fetchImpl: options.fetchImpl,
  });

  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
  }

  if (!fullText.trim()) {
    throw new Error("Vision model returned empty description.");
  }

  return { text: fullText.trim(), modelId: result.canonicalModelId };
}
