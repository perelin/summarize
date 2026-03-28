/**
 * Image upload handler: describes an uploaded image using a vision-capable LLM.
 *
 * The returned text is a detailed description of the image contents — including
 * any visible text, data, tables, charts, or numbers — which can then be fed
 * into the summarization pipeline as plain text.
 */
import { streamText, type LiteLlmConnection } from "../../llm/generate-text.js";
import type { Prompt } from "../../llm/prompt.js";

export async function describeImage(
  file: { name: string; type: string; bytes: Uint8Array },
  options: {
    connection: LiteLlmConnection;
    modelId: string;
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

  const result = await streamText({
    modelId: options.modelId,
    connection: options.connection,
    prompt,
    temperature: 0,
    maxOutputTokens: 4096,
    timeoutMs: 120_000,
  });

  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
  }

  if (!fullText.trim()) {
    throw new Error("Vision model returned empty description.");
  }

  return { text: fullText.trim(), modelId: result.modelId };
}
