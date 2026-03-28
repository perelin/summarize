import { generateText, type LiteLlmConnection } from "../llm/generate-text.js";
import type { Prompt } from "../llm/prompt.js";
import type { LlmTokenUsage } from "../llm/types.js";

export async function summarizeWithModel({
  modelId,
  connection,
  prompt,
  maxOutputTokens,
  timeoutMs,
}: {
  modelId: string;
  connection: LiteLlmConnection;
  prompt: Prompt;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<{
  text: string;
  modelId: string;
  usage: LlmTokenUsage | null;
}> {
  return generateText({
    modelId,
    connection,
    prompt,
    temperature: 0,
    maxOutputTokens,
    timeoutMs,
  });
}
