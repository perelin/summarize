import { createHtmlToMarkdownConverter } from "../../../llm/html-to-markdown.js";
import {
  type ConvertTranscriptToMarkdown,
  createTranscriptToMarkdownConverter,
} from "../../../llm/transcript-to-markdown.js";
import { convertToMarkdownWithMarkitdown } from "../../../markitdown.js";
import { hasUvxCli } from "../../env.js";
import type { UrlFlowContext } from "./types.js";

export type MarkdownConverters = {
  markdownRequested: boolean;
  transcriptMarkdownRequested: boolean;
  effectiveMarkdownMode: "off" | "auto" | "llm" | "readability";
  convertHtmlToMarkdown:
    | ((args: {
        url: string;
        html: string;
        title: string | null;
        siteName: string | null;
        timeoutMs: number;
      }) => Promise<string>)
    | null;
  convertTranscriptToMarkdown: ConvertTranscriptToMarkdown | null;
};

export function createMarkdownConverters(
  ctx: UrlFlowContext,
  options: { isYoutubeUrl: boolean },
): MarkdownConverters {
  // HTML markdown conversion (for non-YouTube URLs)
  const wantsHtmlMarkdown = ctx.flags.format === "markdown" && !options.isYoutubeUrl;
  if (wantsHtmlMarkdown && ctx.flags.markdownMode === "off") {
    throw new Error("--format md conflicts with --markdown-mode off (use --format text)");
  }

  // Transcript markdown conversion (for YouTube URLs, only when --markdown-mode llm is explicit)
  const wantsTranscriptMarkdown =
    ctx.flags.format === "markdown" &&
    options.isYoutubeUrl &&
    ctx.flags.markdownMode === "llm" &&
    !ctx.flags.transcriptTimestamps;

  const markdownRequested = wantsHtmlMarkdown;
  const transcriptMarkdownRequested = wantsTranscriptMarkdown;
  const effectiveMarkdownMode =
    markdownRequested || transcriptMarkdownRequested ? ctx.flags.markdownMode : "off";

  const needsLlmMarkdown = markdownRequested || transcriptMarkdownRequested;

  const llmHtmlToMarkdown =
    markdownRequested &&
    needsLlmMarkdown &&
    (effectiveMarkdownMode === "llm" || effectiveMarkdownMode === "auto")
      ? createHtmlToMarkdownConverter({
          modelId: ctx.model.modelId,
          connection: ctx.model.connection,
          onUsage: ({ model: usedModel, usage }) => {
            ctx.model.llmCalls.push({ model: usedModel, usage, purpose: "markdown" });
          },
        })
      : null;

  const markitdownHtmlToMarkdown =
    markdownRequested && ctx.flags.preprocessMode !== "off" && hasUvxCli(ctx.io.env)
      ? async (args: {
          url: string;
          html: string;
          title: string | null;
          siteName: string | null;
          timeoutMs: number;
        }) => {
          void args.url;
          void args.title;
          void args.siteName;
          return convertToMarkdownWithMarkitdown({
            bytes: new TextEncoder().encode(args.html),
            filenameHint: "page.html",
            mediaTypeHint: "text/html",
            uvxCommand: ctx.io.envForRun.UVX_PATH,
            timeoutMs: args.timeoutMs,
            env: ctx.io.env,
            execFileImpl: ctx.io.execFileImpl,
          });
        }
      : null;

  const convertHtmlToMarkdown = markdownRequested
    ? async (args: {
        url: string;
        html: string;
        title: string | null;
        siteName: string | null;
        timeoutMs: number;
      }) => {
        if (effectiveMarkdownMode === "llm") {
          if (!llmHtmlToMarkdown) {
            throw new Error("No HTML→Markdown converter configured");
          }
          return llmHtmlToMarkdown(args);
        }

        if (ctx.flags.extractMode) {
          if (markitdownHtmlToMarkdown) {
            return await markitdownHtmlToMarkdown(args);
          }
          throw new Error(
            "No HTML→Markdown converter configured (install uvx/markitdown or use --markdown-mode llm)",
          );
        }

        if (llmHtmlToMarkdown) {
          try {
            return await llmHtmlToMarkdown(args);
          } catch (error) {
            if (!markitdownHtmlToMarkdown) throw error;
            return await markitdownHtmlToMarkdown(args);
          }
        }

        if (markitdownHtmlToMarkdown) {
          return await markitdownHtmlToMarkdown(args);
        }

        throw new Error("No HTML→Markdown converter configured");
      }
    : null;

  // Transcript→Markdown converter (only for YouTube with --markdown-mode llm)
  const convertTranscriptToMarkdown: ConvertTranscriptToMarkdown | null =
    transcriptMarkdownRequested
      ? createTranscriptToMarkdownConverter({
          modelId: ctx.model.modelId,
          connection: ctx.model.connection,
          onUsage: ({ model: usedModel, usage }) => {
            ctx.model.llmCalls.push({ model: usedModel, usage, purpose: "markdown" });
          },
        })
      : null;

  return {
    markdownRequested,
    transcriptMarkdownRequested,
    effectiveMarkdownMode,
    convertHtmlToMarkdown,
    convertTranscriptToMarkdown,
  };
}
