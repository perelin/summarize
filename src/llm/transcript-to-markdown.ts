import type { OutputLanguage } from "../language.js";
import { formatOutputLanguageInstruction } from "../language.js";
import type { LlmTokenUsage } from "./types.js";
import { generateText, type LiteLlmConnection } from "./generate-text.js";

const MAX_TRANSCRIPT_INPUT_CHARACTERS = 200_000;

function buildTranscriptToMarkdownPrompt({
  title,
  source,
  transcript,
  outputLanguage,
}: {
  title: string | null;
  source: string | null;
  transcript: string;
  outputLanguage?: OutputLanguage | null;
}): { system: string; prompt: string } {
  const languageInstruction = formatOutputLanguageInstruction(outputLanguage ?? { kind: "auto" });

  const system = `You convert raw transcripts into clean GitHub-Flavored Markdown.

Rules:
- Add paragraph breaks at natural topic transitions
- Add headings (##) for major topic changes
- Format lists, quotes, and emphasis where appropriate
- Light cleanup: remove filler words (um, uh, you know) and false starts
- Do not invent content or change meaning
- Preserve technical terms, names, and quotes accurately
- ${languageInstruction}
- Output ONLY Markdown (no JSON, no explanations, no code fences wrapping the output)`;

  const prompt = `Title: ${title ?? "unknown"}
Source: ${source ?? "unknown"}

Transcript:
"""
${transcript}
"""`;

  return { system, prompt };
}

export type ConvertTranscriptToMarkdown = (args: {
  title: string | null;
  source: string | null;
  transcript: string;
  timeoutMs: number;
  outputLanguage?: OutputLanguage | null;
}) => Promise<string>;

export function createTranscriptToMarkdownConverter({
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
}): ConvertTranscriptToMarkdown {
  return async ({ title, source, transcript, timeoutMs, outputLanguage }) => {
    const trimmedTranscript =
      transcript.length > MAX_TRANSCRIPT_INPUT_CHARACTERS
        ? transcript.slice(0, MAX_TRANSCRIPT_INPUT_CHARACTERS)
        : transcript;
    const { system, prompt } = buildTranscriptToMarkdownPrompt({
      title,
      source,
      transcript: trimmedTranscript,
      outputLanguage,
    });

    const result = await generateText({
      modelId,
      connection,
      prompt: { system, userText: prompt },
      timeoutMs,
    });
    onUsage?.({ model: result.modelId, usage: result.usage ?? null });
    return result.text;
  };
}
