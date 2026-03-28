import type { ExtractedLinkContent } from "../../../content/index.js";
import {
  buildLinkSummaryPrompt,
  SUMMARY_LENGTH_TARGET_CHARACTERS,
} from "../../../prompts/index.js";
import { resolveTargetCharacters } from "../../format.js";
import type { UrlFlowContext } from "./types.js";

export function shouldBypassShortContentSummary({
  extracted,
  lengthArg,
  forceSummary,
  maxOutputTokensArg,
  json,
  countTokens,
}: {
  extracted: ExtractedLinkContent;
  lengthArg: UrlFlowContext["flags"]["lengthArg"];
  forceSummary: boolean;
  maxOutputTokensArg: number | null;
  json: boolean;
  countTokens: (value: string) => number;
}): boolean {
  if (forceSummary) return false;
  if (!extracted.content || extracted.content.length === 0) return false;
  const targetCharacters = resolveTargetCharacters(lengthArg, SUMMARY_LENGTH_TARGET_CHARACTERS);
  if (!Number.isFinite(targetCharacters) || targetCharacters <= 0) return false;
  if (extracted.content.length > targetCharacters) return false;
  if (!json && typeof maxOutputTokensArg === "number") {
    if (countTokens(extracted.content) > maxOutputTokensArg) return false;
  }
  return true;
}

export function buildUrlPrompt({
  extracted,
  outputLanguage,
  lengthArg,
  promptOverride,
  lengthInstruction,
  languageInstruction,
  buildSummaryTimestampLimitInstruction,
}: {
  extracted: ExtractedLinkContent;
  outputLanguage: UrlFlowContext["flags"]["outputLanguage"];
  lengthArg: UrlFlowContext["flags"]["lengthArg"];
  promptOverride?: string | null;
  lengthInstruction?: string | null;
  languageInstruction?: string | null;
  buildSummaryTimestampLimitInstruction: (extracted: ExtractedLinkContent) => string | null;
}): string {
  const isYouTube = extracted.siteName === "YouTube";
  return buildLinkSummaryPrompt({
    url: extracted.url,
    title: extracted.title,
    siteName: extracted.siteName,
    description: extracted.description,
    creatorDescription: extracted.creatorDescription,
    content: extracted.content,
    truncated: extracted.truncated,
    hasTranscript:
      isYouTube ||
      (extracted.transcriptSource !== null && extracted.transcriptSource !== "unavailable"),
    hasTranscriptTimestamps: Boolean(extracted.transcriptTimedText),
    timestampLimitInstruction: buildSummaryTimestampLimitInstruction(extracted),
    summaryLength:
      lengthArg.kind === "preset" ? lengthArg.preset : { maxCharacters: lengthArg.maxCharacters },
    outputLanguage,
    shares: [],
    promptOverride: promptOverride ?? null,
    lengthInstruction: lengthInstruction ?? null,
    languageInstruction: languageInstruction ?? null,
  });
}
