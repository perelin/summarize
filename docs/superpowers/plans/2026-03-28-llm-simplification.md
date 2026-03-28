# LLM Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-provider LLM system with a single LiteLLM gateway, using Mistral Large for text/vision and Voxtral for STT.

**Architecture:** All LLM calls route through one OpenAI-compatible endpoint (LiteLLM). The app stores a base URL and optional API key — nothing provider-specific. Model IDs pass through to LiteLLM as-is. No fallbacks, no auto-selection, no token bands.

**Tech Stack:** TypeScript, `@mariozechner/pi-ai` (provides `completeSimple`/`streamSimple` + synthetic model creation — no new dependencies needed), vitest.

---

## Chunk 1: Foundation — New Types & Config

### Task 1.1: Simplify config types

**Files:**

- Modify: `src/config/types.ts`

- [ ] **Step 1: Read the current file and understand the types**

Read `src/config/types.ts`. Note which types are provider-specific and which are shared.

- [ ] **Step 2: Delete provider-specific config types**

Remove these types entirely:

- `OpenAiConfig` (lines 4-18)
- `AnthropicConfig` (lines 29-36)
- `GoogleConfig` (lines 38-45)
- `NvidiaConfig` (lines 47-56)
- `XaiConfig` (lines 86-93)
- `ZaiConfig` (lines 95-105)

- [ ] **Step 3: Delete auto-selection types**

Remove:

- `AutoRuleKind` (line 1)
- `AutoRule` (lines 107-132)
- `ModelConfig` union type (lines 134-142)

- [ ] **Step 4: Simplify ApiKeysConfig**

Replace the current `ApiKeysConfig` with only non-LLM keys:

```typescript
export type ApiKeysConfig = {
  apify?: string;
  firecrawl?: string;
};
```

- [ ] **Step 5: Add LiteLLM config type**

Add at the top of the file:

```typescript
export type LiteLlmConfig = {
  baseUrl?: string;
  apiKey?: string;
};
```

- [ ] **Step 6: Update SummarizeConfig**

Replace the model/models/provider sections in `SummarizeConfig`:

```typescript
export type SummarizeConfig = {
  accounts?: Account[];
  /** LiteLLM gateway configuration. */
  litellm?: LiteLlmConfig;
  /** Model ID for summarization/chat (passed to LiteLLM as-is). */
  model?: string;
  /** Model ID for speech-to-text (passed to LiteLLM as-is). */
  sttModel?: string;
  language?: string;
  prompt?: string;
  cache?: {
    enabled?: boolean;
    maxMb?: number;
    ttlDays?: number;
    path?: string;
    media?: MediaCacheConfig;
  };
  history?: {
    enabled?: boolean;
    path?: string;
    mediaPath?: string;
  };
  media?: {
    videoMode?: VideoMode;
  };
  slides?: {
    enabled?: boolean;
    ocr?: boolean;
    dir?: string;
    sceneThreshold?: number;
    max?: number;
    minDuration?: number;
  };
  output?: {
    language?: string;
  };
  logging?: LoggingConfig;
  env?: EnvConfig;
  apiKeys?: ApiKeysConfig;
};
```

Removed: `models`, `openai`, `nvidia`, `anthropic`, `google`, `xai`, `zai` fields.

- [ ] **Step 7: Run `pnpm tsc --noEmit` to see what breaks**

Run: `pnpm tsc --noEmit 2>&1 | head -80`

This will show all downstream compilation errors. Don't fix them yet — this is expected. Just verify the type changes are internally consistent.

- [ ] **Step 8: Commit**

```bash
git add src/config/types.ts
git commit -m "refactor: simplify config types — remove provider-specific configs, add LiteLLM config"
```

### Task 1.2: Simplify run-env.ts

**Files:**

- Modify: `src/run/run-env.ts`

- [ ] **Step 1: Replace EnvState with simplified version**

Replace the entire `EnvState` type and `resolveEnvState` function. The new version only resolves LiteLLM connection + non-LLM keys:

```typescript
import type { SummarizeConfig } from "../config.js";
import { resolveExecutableInPath } from "./env.js";

export type EnvState = {
  /** LiteLLM gateway base URL. */
  litellmBaseUrl: string;
  /** LiteLLM API key (optional, depends on gateway config). */
  litellmApiKey: string | null;
  /** Model ID for summarization (from env override or config). */
  model: string;
  /** Model ID for STT (from config). */
  sttModel: string;
  /** Firecrawl API key for content extraction. */
  firecrawlApiKey: string | null;
  firecrawlConfigured: boolean;
  /** Apify token for content extraction. */
  apifyToken: string | null;
  /** yt-dlp binary path. */
  ytDlpPath: string | null;
  ytDlpCookiesFromBrowser: string | null;
};

const DEFAULT_LITELLM_BASE_URL = "http://10.10.10.10:4000";
const DEFAULT_MODEL = "mistral/mistral-large-latest";
const DEFAULT_STT_MODEL = "mistral/voxtral-mini-latest";

export function resolveEnvState({
  env,
  envForRun,
  config,
}: {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  config: SummarizeConfig | null;
}): EnvState {
  const litellmBaseUrl =
    envForRun.LITELLM_BASE_URL?.trim() ||
    config?.litellm?.baseUrl?.trim() ||
    DEFAULT_LITELLM_BASE_URL;

  const litellmApiKey =
    envForRun.LITELLM_API_KEY?.trim() || config?.litellm?.apiKey?.trim() || null;

  const model = envForRun.SUMMARIZE_MODEL?.trim() || config?.model?.trim() || DEFAULT_MODEL;

  const sttModel = config?.sttModel?.trim() || DEFAULT_STT_MODEL;

  const firecrawlApiKey =
    typeof envForRun.FIRECRAWL_API_KEY === "string" && envForRun.FIRECRAWL_API_KEY.trim().length > 0
      ? envForRun.FIRECRAWL_API_KEY
      : null;

  const apifyToken =
    typeof envForRun.APIFY_API_TOKEN === "string" ? envForRun.APIFY_API_TOKEN : null;

  const ytDlpPath = (() => {
    const explicit = typeof envForRun.YT_DLP_PATH === "string" ? envForRun.YT_DLP_PATH.trim() : "";
    if (explicit.length > 0) return explicit;
    return resolveExecutableInPath("yt-dlp", envForRun);
  })();

  const ytDlpCookiesFromBrowser = (() => {
    const raw =
      typeof envForRun.SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER === "string"
        ? envForRun.SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER
        : typeof envForRun.YT_DLP_COOKIES_FROM_BROWSER === "string"
          ? envForRun.YT_DLP_COOKIES_FROM_BROWSER
          : "";
    const value = raw.trim();
    return value.length > 0 ? value : null;
  })();

  return {
    litellmBaseUrl,
    litellmApiKey,
    model,
    sttModel,
    firecrawlApiKey,
    firecrawlConfigured: firecrawlApiKey !== null,
    apifyToken,
    ytDlpPath,
    ytDlpCookiesFromBrowser,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/run/run-env.ts
git commit -m "refactor: simplify run-env — replace 12 provider keys with LiteLLM base URL + API key"
```

### Task 1.3: Simplify run types

**Files:**

- Modify: `src/run/types.ts`

- [ ] **Step 1: Replace the full file**

```typescript
export type ModelMeta = {
  model: string;
};
```

The old `ModelAttempt`, `ModelAttemptRequiredEnv`, `MarkdownModel` types are no longer needed — there's only one model, one attempt, no transport/provider distinction.

- [ ] **Step 2: Commit**

```bash
git add src/run/types.ts
git commit -m "refactor: simplify run types — remove ModelAttempt, keep only ModelMeta"
```

---

## Chunk 2: New LLM Layer — Replace generate-text.ts

### Task 2.1: Rewrite generate-text.ts

**Files:**

- Rewrite: `src/llm/generate-text.ts`

This is the core change. Replace 898 lines of 6-provider branching with a single OpenAI-compatible client pointing at LiteLLM.

- [ ] **Step 1: Write the new generate-text.ts**

```typescript
import { completeSimple, streamSimple } from "@mariozechner/pi-ai";
import type { Api, Context, Message, Model } from "@mariozechner/pi-ai";
import type { Prompt } from "./prompt.js";
import { userTextAndImageMessage } from "./prompt.js";
import type { LlmTokenUsage } from "./types.js";
import { normalizeTokenUsage } from "./usage.js";

export type { LlmTokenUsage } from "./types.js";

export type LiteLlmConnection = {
  baseUrl: string;
  apiKey: string | null;
};

function promptToContext(prompt: Prompt): Context {
  const attachments = prompt.attachments ?? [];
  if (attachments.length === 0) {
    return {
      systemPrompt: prompt.system,
      messages: [{ role: "user", content: prompt.userText, timestamp: Date.now() }],
    };
  }
  if (attachments.length === 1 && attachments[0]?.kind === "image") {
    const attachment = attachments[0];
    const messages: Message[] = [
      userTextAndImageMessage({
        text: prompt.userText,
        imageBytes: attachment.bytes,
        mimeType: attachment.mediaType,
      }),
    ];
    return { systemPrompt: prompt.system, messages };
  }
  if (attachments.length === 1 && attachments[0]?.kind === "document") {
    throw new Error("Document attachments are not yet supported via LiteLLM gateway.");
  }
  throw new Error("Internal error: unsupported attachment combination.");
}

function wantsImages(context: Context): boolean {
  for (const msg of context.messages) {
    if (msg.role === "user" || msg.role === "toolResult") {
      if (Array.isArray(msg.content) && msg.content.some((c) => c.type === "image")) return true;
    }
  }
  return false;
}

/**
 * Create a pi-ai Model pointing at LiteLLM.
 *
 * Uses "openai-completions" API since LiteLLM exposes an OpenAI-compatible endpoint.
 * The model ID is passed through to LiteLLM as-is (e.g. "mistral/mistral-large-latest").
 */
function createLiteLlmModel(
  connection: LiteLlmConnection,
  modelId: string,
  context: Context,
): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "openai",
    baseUrl: connection.baseUrl,
    reasoning: false,
    input: wantsImages(context) ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256_000,
    maxTokens: 16_384,
  };
}

function extractText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: string; text: string }).text)
    .join("")
    .trim();
}

export async function generateText({
  modelId,
  connection,
  prompt,
  temperature,
  maxOutputTokens,
  timeoutMs,
}: {
  modelId: string;
  connection: LiteLlmConnection;
  prompt: Prompt;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<{
  text: string;
  modelId: string;
  usage: LlmTokenUsage | null;
}> {
  const context = promptToContext(prompt);
  const model = createLiteLlmModel(connection, modelId, context);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await completeSimple(model, context, {
      ...(typeof temperature === "number" ? { temperature } : {}),
      ...(typeof maxOutputTokens === "number" ? { maxTokens: maxOutputTokens } : {}),
      apiKey: connection.apiKey ?? "not-needed",
      signal: controller.signal,
    });

    const text = extractText(result);
    if (!text) throw new Error(`LLM returned an empty response (model ${modelId}).`);

    return {
      text,
      modelId,
      usage: normalizeTokenUsage(result.usage),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`LLM request timed out after ${timeoutMs}ms (model ${modelId}).`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function streamUsageWithTimeout({
  result,
  timeoutMs,
}: {
  result: Promise<{ usage?: unknown }>;
  timeoutMs: number;
}): Promise<LlmTokenUsage | null> {
  const normalized = result.then((msg) => normalizeTokenUsage(msg.usage)).catch(() => null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    normalized,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function streamText({
  modelId,
  connection,
  prompt,
  temperature,
  maxOutputTokens,
  timeoutMs,
}: {
  modelId: string;
  connection: LiteLlmConnection;
  prompt: Prompt;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<{
  textStream: AsyncIterable<string>;
  modelId: string;
  usage: Promise<LlmTokenUsage | null>;
  lastError: () => unknown;
}> {
  const context = promptToContext(prompt);
  return streamTextWithContext({
    modelId,
    connection,
    context,
    temperature,
    maxOutputTokens,
    timeoutMs,
  });
}

export async function streamTextWithContext({
  modelId,
  connection,
  context,
  temperature,
  maxOutputTokens,
  timeoutMs,
}: {
  modelId: string;
  connection: LiteLlmConnection;
  context: Context;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<{
  textStream: AsyncIterable<string>;
  modelId: string;
  usage: Promise<LlmTokenUsage | null>;
  lastError: () => unknown;
}> {
  const model = createLiteLlmModel(connection, modelId, context);
  const controller = new AbortController();
  let lastError: unknown = null;
  const startedAtMs = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutError = new Error("LLM request timed out");

  const markTimedOut = () => {
    if (lastError === timeoutError) return;
    lastError = timeoutError;
    controller.abort();
  };

  const startTimeout = () => {
    if (timeoutId) return;
    timeoutId = setTimeout(markTimedOut, timeoutMs);
  };

  const stopTimeout = () => {
    if (!timeoutId) return;
    clearTimeout(timeoutId);
    timeoutId = null;
  };

  const nextWithDeadline = async <T>(promise: Promise<T>): Promise<T> => {
    const elapsed = Date.now() - startedAtMs;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      markTimedOut();
      throw timeoutError;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            markTimedOut();
            reject(timeoutError);
          }, remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const stream = streamSimple(model, context, {
    ...(typeof temperature === "number" ? { temperature } : {}),
    ...(typeof maxOutputTokens === "number" ? { maxTokens: maxOutputTokens } : {}),
    apiKey: connection.apiKey ?? "not-needed",
    signal: controller.signal,
  });

  const textStream: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {
      startTimeout();
      const iterator = stream[Symbol.asyncIterator]();
      try {
        while (true) {
          const result = await nextWithDeadline(iterator.next());
          if (result.done) break;
          const event = result.value;
          if (event.type === "text_delta") yield event.delta;
          if (event.type === "error") {
            lastError = event.error;
            break;
          }
        }
      } finally {
        stopTimeout();
        if (typeof iterator.return === "function") {
          const cleanup = iterator.return();
          const cleanupPromise =
            typeof cleanup === "undefined" ? undefined : (cleanup as Promise<unknown>);
          if (typeof cleanupPromise?.catch === "function") {
            void cleanupPromise.catch(() => {});
          }
        }
      }
    },
  };

  return {
    textStream,
    modelId,
    usage: streamUsageWithTimeout({ result: stream.result(), timeoutMs }),
    lastError: () => lastError,
  };
}
```

Note: This uses `@mariozechner/pi-ai`'s `completeSimple`/`streamSimple` with a synthetic `Model` object pointing at LiteLLM. The model uses `api: "openai-completions"` since LiteLLM exposes an OpenAI-compatible endpoint. This preserves the existing streaming infrastructure while routing all traffic through one endpoint. No new dependencies needed.

- [ ] **Step 2: Verify the new file compiles in isolation**

Run: `pnpm tsc --noEmit src/llm/generate-text.ts 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/llm/generate-text.ts
git commit -m "refactor: rewrite generate-text — single LiteLLM gateway, no provider branching"
```

### Task 2.2: Delete provider-specific files

**Files:**

- Delete: `src/llm/providers/anthropic.ts`
- Delete: `src/llm/providers/openai.ts`
- Delete: `src/llm/providers/google.ts`
- Delete: `src/llm/providers/models.ts`
- Delete: `src/llm/providers/shared.ts`
- Delete: `src/llm/providers/types.ts`
- Delete: `src/llm/provider-capabilities.ts`
- Delete: `src/llm/model-id.ts`
- Delete: `src/run/openrouter.ts`
- Delete: `src/model-auto.ts`
- Delete: `src/model-spec.ts`
- Delete: `config/default-models.json`
- Delete: `src/config/default-models.ts`
- Delete: `src/run/model-attempts.ts`

- [ ] **Step 1: Delete all files**

```bash
rm src/llm/providers/anthropic.ts \
   src/llm/providers/openai.ts \
   src/llm/providers/google.ts \
   src/llm/providers/models.ts \
   src/llm/providers/shared.ts \
   src/llm/providers/types.ts \
   src/llm/provider-capabilities.ts \
   src/llm/model-id.ts \
   src/run/openrouter.ts \
   src/model-auto.ts \
   src/model-spec.ts \
   config/default-models.json \
   src/config/default-models.ts \
   src/run/model-attempts.ts
```

- [ ] **Step 2: Remove the providers directory if empty**

```bash
rmdir src/llm/providers 2>/dev/null || true
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: delete multi-provider LLM layer — 14 files, ~1900 lines removed"
```

---

## Chunk 3: Update Call Sites

### Task 3.1: Simplify html-to-markdown.ts

**Files:**

- Modify: `src/llm/html-to-markdown.ts`

- [ ] **Step 1: Rewrite the converter factory**

Replace the factory to accept `LiteLlmConnection` + `modelId` instead of per-provider keys:

```typescript
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
  onUsage?: (usage: { model: string; usage: LlmTokenUsage | null }) => void;
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
```

- [ ] **Step 2: Commit**

```bash
git add src/llm/html-to-markdown.ts
git commit -m "refactor: simplify html-to-markdown — use LiteLLM connection"
```

### Task 3.2: Simplify transcript-to-markdown.ts

**Files:**

- Modify: `src/llm/transcript-to-markdown.ts`

- [ ] **Step 1: Rewrite the converter factory**

Same pattern as html-to-markdown — accept `LiteLlmConnection` + `modelId`:

```typescript
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
  onUsage?: (usage: { model: string; usage: LlmTokenUsage | null }) => void;
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
```

- [ ] **Step 2: Commit**

```bash
git add src/llm/transcript-to-markdown.ts
git commit -m "refactor: simplify transcript-to-markdown — use LiteLLM connection"
```

### Task 3.3: Simplify upload-image handler

**Files:**

- Modify: `src/server/handlers/upload-image.ts`

- [ ] **Step 1: Rewrite to use streamText + LiteLLM connection**

```typescript
/**
 * Image upload handler: describes an uploaded image using a vision-capable LLM.
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
```

- [ ] **Step 2: Find and update all callers of `describeImage`**

Search for imports of `describeImage` and update them to pass `connection` + `modelId` instead of `env` + `modelOverride`:

```bash
grep -rn "describeImage" src/ --include="*.ts"
```

Update each call site to construct a `LiteLlmConnection` from the `EnvState` and pass `envState.model` as the modelId.

- [ ] **Step 3: Commit**

```bash
git add src/server/handlers/upload-image.ts
git commit -m "refactor: simplify upload-image handler — use LiteLLM connection"
```

### Task 3.4: Simplify chat.ts

**Files:**

- Modify: `src/summarize/chat.ts`

- [ ] **Step 1: Rewrite to use streamTextWithContext + LiteLLM connection**

Remove `resolveApiKeys`, `buildAutoModelAttempts`, `parseRequestedModelId` imports. Replace with direct LiteLLM streaming:

```typescript
import type { Context, Message } from "@mariozechner/pi-ai";
import { streamTextWithContext, type LiteLlmConnection } from "../llm/generate-text.js";

type ChatEvent = { event: string; data?: unknown };

export type WebChatContext = {
  summaryId: string;
  summary: string;
  sourceText?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
};

export type WebChatSink = {
  onChunk: (text: string) => void;
  onModel: (model: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
};

const SYSTEM_PROMPT = `You are Summarize_p2 Chat.

You answer questions about the original source document. Keep responses concise and grounded in the source material.`;

function normalizeMessages(messages: Message[]): Message[] {
  return messages.map((message) => ({
    ...message,
    timestamp: message.timestamp ?? Date.now(),
  }));
}

function buildWebChatContext(ctx: WebChatContext, userMessage: string): Context {
  const header = ctx.sourceTitle
    ? `${ctx.sourceTitle}${ctx.sourceUrl ? ` (${ctx.sourceUrl})` : ""}`
    : (ctx.sourceUrl ?? "content");

  const sourceSection = ctx.sourceText
    ? `\n\nFull source text of ${header}:\n${ctx.sourceText}\n\nSummary:\n${ctx.summary}`
    : `\n\nSummary of ${header}:\n${ctx.summary}`;

  const systemPrompt = `${SYSTEM_PROMPT}${sourceSection}`;
  const messages: Message[] = [];

  for (const msg of ctx.history) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content, timestamp: Date.now() });
    } else {
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: msg.content }],
        api: "openai",
        provider: "openai",
        model: "unknown",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      } as Message);
    }
  }

  messages.push({ role: "user", content: userMessage, timestamp: Date.now() });
  return { systemPrompt, messages: normalizeMessages(messages) };
}

export async function streamWebChatResponse({
  connection,
  modelId,
  webContext,
  userMessage,
  sink,
}: {
  connection: LiteLlmConnection;
  modelId: string;
  webContext: WebChatContext;
  userMessage: string;
  sink: WebChatSink;
}): Promise<{ usedModel: string; responseText: string }> {
  const context = buildWebChatContext(webContext, userMessage);
  const chunks: string[] = [];

  sink.onModel(modelId);

  try {
    const result = await streamTextWithContext({
      modelId,
      connection,
      context,
      timeoutMs: 60_000,
    });

    for await (const chunk of result.textStream) {
      chunks.push(chunk);
      sink.onChunk(chunk);
    }

    sink.onDone();
  } catch (err) {
    sink.onError(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }

  return { usedModel: modelId, responseText: chunks.join("") };
}
```

- [ ] **Step 2: Find and update all callers of `streamWebChatResponse`**

```bash
grep -rn "streamWebChatResponse" src/ --include="*.ts"
```

Update callers to pass `connection` + `modelId` from `EnvState`.

- [ ] **Step 3: Commit**

```bash
git add src/summarize/chat.ts
git commit -m "refactor: simplify chat — use LiteLLM connection, remove auto-model selection"
```

---

## Chunk 4: Update Summary Engine & Flow Files

### Task 4.1: Rewrite summary-llm.ts

**Files:**

- Modify: `src/run/summary-llm.ts`

- [ ] **Step 1: Simplify to a thin wrapper**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/run/summary-llm.ts
git commit -m "refactor: simplify summary-llm — thin wrapper over generateText"
```

### Task 4.2: Rewrite summary-engine.ts

**Files:**

- Modify: `src/run/summary-engine.ts`

This is the most complex call site. The current version handles per-provider API key resolution, OpenAI gateway overrides (zai/nvidia), model resolution, and streaming fallbacks.

- [ ] **Step 1: Simplify SummaryEngineDeps**

Replace the deps type — remove all provider-specific fields:

```typescript
import { countTokens } from "gpt-tokenizer";
import { formatCompactCount } from "../core/shared/format.js";
import { streamText, type LiteLlmConnection } from "../llm/generate-text.js";
import type { Prompt } from "../llm/prompt.js";
import type { LlmTokenUsage } from "../llm/types.js";
import { createRetryLogger, writeVerbose } from "./logging.js";
import { mergeStreamingChunk } from "./streaming.js";
import { summarizeWithModel } from "./summary-llm.js";
import type { ModelMeta } from "./types.js";

export type SummaryEngineDeps = {
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  timeoutMs: number;
  streamingEnabled: boolean;
  verbose: boolean;
  verboseColor: boolean;
  connection: LiteLlmConnection;
  modelId: string;
  resolveMaxOutputTokensForCall: (modelId: string) => Promise<number | null>;
  resolveMaxInputTokensForCall: (modelId: string) => Promise<number | null>;
  llmCalls: Array<{
    model: string;
    usage: LlmTokenUsage | null;
    costUsd?: number | null;
    purpose: "summary" | "markdown";
  }>;
  clearProgressForStdout: () => void;
  restoreProgressAfterStdout?: (() => void) | null;
};
```

- [ ] **Step 2: Simplify createSummaryEngine**

The engine no longer needs `envHasKeyFor`, `formatMissingModelError`, `applyOpenAiGatewayOverrides`. The `runSummaryAttempt` simplifies dramatically — no attempt chain, just one call:

```typescript
export type SummaryStreamHandler = {
  onChunk: (args: {
    streamed: string;
    prevStreamed: string;
    appended: string;
  }) => void | Promise<void>;
  onDone?: ((finalText: string) => void | Promise<void>) | null;
};

export function createSummaryEngine(deps: SummaryEngineDeps) {
  const runSummary = async ({
    prompt,
    allowStreaming,
    onModelChosen,
    streamHandler,
  }: {
    prompt: Prompt;
    allowStreaming: boolean;
    onModelChosen?: ((modelId: string) => void) | null;
    streamHandler?: SummaryStreamHandler | null;
  }): Promise<{
    summary: string;
    summaryAlreadyPrinted: boolean;
    modelMeta: ModelMeta;
    maxOutputTokensForCall: number | null;
  }> => {
    onModelChosen?.(deps.modelId);

    const maxOutputTokensForCall = await deps.resolveMaxOutputTokensForCall(deps.modelId);
    const maxInputTokensForCall = await deps.resolveMaxInputTokensForCall(deps.modelId);

    if (
      typeof maxInputTokensForCall === "number" &&
      Number.isFinite(maxInputTokensForCall) &&
      maxInputTokensForCall > 0 &&
      (prompt.attachments?.length ?? 0) === 0
    ) {
      const tokenCount = countTokens(prompt.userText);
      if (tokenCount > maxInputTokensForCall) {
        throw new Error(
          `Input token count (${formatCompactCount(tokenCount)}) exceeds model input limit (${formatCompactCount(maxInputTokensForCall)}). Tokenized with GPT tokenizer; prompt included.`,
        );
      }
    }

    const useStreaming = allowStreaming && deps.streamingEnabled;

    if (!useStreaming) {
      const result = await summarizeWithModel({
        modelId: deps.modelId,
        connection: deps.connection,
        prompt,
        maxOutputTokens: maxOutputTokensForCall ?? undefined,
        timeoutMs: deps.timeoutMs,
      });
      deps.llmCalls.push({
        model: result.modelId,
        usage: result.usage,
        purpose: "summary",
      });
      const summary = result.text.trim();
      if (!summary) throw new Error("LLM returned an empty summary");
      return {
        summary,
        summaryAlreadyPrinted: false,
        modelMeta: { model: deps.modelId },
        maxOutputTokensForCall: maxOutputTokensForCall ?? null,
      };
    }

    // Streaming path
    const streamResult = await streamText({
      modelId: deps.modelId,
      connection: deps.connection,
      prompt,
      temperature: 0,
      maxOutputTokens: maxOutputTokensForCall ?? undefined,
      timeoutMs: deps.timeoutMs,
    });

    deps.clearProgressForStdout();
    deps.restoreProgressAfterStdout?.();

    let summaryAlreadyPrinted = false;
    let streamed = "";
    let streamedRaw = "";

    try {
      for await (const delta of streamResult.textStream) {
        const prevStreamed = streamed;
        const merged = mergeStreamingChunk(streamed, delta);
        streamed = merged.next;
        if (streamHandler) {
          await streamHandler.onChunk({
            streamed: merged.next,
            prevStreamed,
            appended: merged.appended,
          });
        }
      }
      streamedRaw = streamed;
      streamed = streamed.trim();
    } finally {
      if (streamHandler) {
        await streamHandler.onDone?.(streamedRaw || streamed);
        summaryAlreadyPrinted = true;
      }
    }

    const usage = await streamResult.usage;
    deps.llmCalls.push({
      model: streamResult.modelId,
      usage,
      purpose: "summary",
    });

    const summary = streamed.trim();
    if (summary.length === 0) {
      const last = streamResult.lastError();
      if (last instanceof Error) {
        throw new Error(last.message, { cause: last });
      }
      throw new Error("LLM returned an empty summary");
    }

    if (streamHandler && !summaryAlreadyPrinted) {
      await streamHandler.onChunk({ streamed: summary, prevStreamed: "", appended: summary });
      await streamHandler.onDone?.(summary);
      summaryAlreadyPrinted = true;
    }

    return {
      summary,
      summaryAlreadyPrinted,
      modelMeta: { model: deps.modelId },
      maxOutputTokensForCall: maxOutputTokensForCall ?? null,
    };
  };

  return { runSummary };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/run/summary-engine.ts
git commit -m "refactor: simplify summary-engine — remove provider branching, single model path"
```

### Task 4.3: Update summary flow files

**Files:**

- Modify: `src/run/flows/url/summary.ts`
- Modify: `src/run/flows/asset/summary.ts`

These files import `buildAutoModelAttempts`, `runModelAttempts`, `buildOpenRouterNoAllowedProvidersMessage`, and `ModelAttempt`. They need to be updated to use the simplified summary engine.

- [ ] **Step 1: Read both flow files completely**

Read `src/run/flows/url/summary.ts` and `src/run/flows/asset/summary.ts` in full to understand how they wire up model attempts and call the summary engine.

- [ ] **Step 2: Remove auto-model-attempt logic from url/summary.ts**

Replace the `buildAutoModelAttempts` + `runModelAttempts` pattern with a direct call to `engine.runSummary(...)`. The model is already known from `deps.modelId` — no attempt chain needed.

Remove imports: `buildAutoModelAttempts`, `runModelAttempts`, `buildOpenRouterNoAllowedProvidersMessage`, `ModelAttempt`.

- [ ] **Step 3: Do the same for asset/summary.ts**

Same pattern — remove attempt chain, use `engine.runSummary(...)` directly.

- [ ] **Step 4: Commit**

```bash
git add src/run/flows/url/summary.ts src/run/flows/asset/summary.ts
git commit -m "refactor: simplify flow files — remove model attempt chains"
```

### Task 4.4: Update run-models.ts

**Files:**

- Modify: `src/run/run-models.ts`

- [ ] **Step 1: Simplify model resolution**

The model is now just a string from config/env. No named presets, no auto/fixed distinction:

```typescript
export type ModelSelection = {
  modelId: string;
  source: "explicit" | "env" | "config" | "default";
};

export function resolveModelSelection({
  config,
  envForRun,
  explicitModelArg,
}: {
  config: { model?: string } | null;
  envForRun: Record<string, string | undefined>;
  explicitModelArg: string | null;
}): ModelSelection {
  if (explicitModelArg?.trim()) {
    return { modelId: explicitModelArg.trim(), source: "explicit" };
  }
  if (envForRun.SUMMARIZE_MODEL?.trim()) {
    return { modelId: envForRun.SUMMARIZE_MODEL.trim(), source: "env" };
  }
  if (config?.model?.trim()) {
    return { modelId: config.model.trim(), source: "config" };
  }
  return { modelId: "mistral/mistral-large-latest", source: "default" };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/run/run-models.ts
git commit -m "refactor: simplify run-models — direct model ID resolution"
```

---

## Chunk 5: Delete Stale Files & Fix Remaining Compilation Errors

### Task 5.1: Delete stale Google model resolution

**Files:**

- Check and delete if exists: `src/llm/google-models.ts`
- Check and delete if exists: `src/run/constants.ts` (if it only contained builtin model presets)
- Check and delete if exists: `src/run/streaming.ts` — check if `canStream` still references providers; simplify if needed

- [ ] **Step 1: Check each file**

```bash
grep -l "google\|provider\|openrouter" src/llm/google-models.ts src/run/constants.ts src/run/streaming.ts 2>/dev/null
```

Read each file. Delete if it's purely provider-specific. Simplify if it has mixed content.

- [ ] **Step 2: Delete or simplify as needed**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: clean up stale provider-specific files"
```

### Task 5.2: Fix all remaining compilation errors

- [ ] **Step 1: Run full type check**

```bash
pnpm tsc --noEmit 2>&1 | head -120
```

- [ ] **Step 2: Fix each error**

Work through errors file by file. Common fixes:

- Update imports to use new `LiteLlmConnection` type
- Replace `ModelAttempt` usage with direct model ID
- Replace `LlmApiKeys` with `LiteLlmConnection`
- Replace `provider: "xai" | "openai" | ...` with just `model: string`
- Update `SummaryEngineDeps` construction in wiring code
- Update config parsing to match new `SummarizeConfig` shape

- [ ] **Step 3: Run type check again until clean**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: resolve all compilation errors from LLM simplification"
```

---

## Chunk 6: Fix Tests

### Task 6.1: Delete provider-specific tests

**Files:**

- Delete: `tests/llm.generate-text.test.ts`
- Delete: `tests/llm.generate-text.more-branches.test.ts`
- Delete: `tests/llm.provider-capabilities.test.ts`
- Delete: `tests/model-spec.test.ts`
- Delete: `tests/model-auto.test.ts` (if exists)
- Delete: `tests/live/openrouter-fallback.live.test.ts`
- Delete: `tests/live/google-preview-fallback.live.test.ts`
- Delete: `tests/run-env.test.ts` (will rewrite)
- Delete: `tests/model-attempts.test.ts` (if exists)

- [ ] **Step 1: Delete the test files**

```bash
rm -f tests/llm.generate-text.test.ts \
      tests/llm.generate-text.more-branches.test.ts \
      tests/llm.provider-capabilities.test.ts \
      tests/model-spec.test.ts \
      tests/model-auto.test.ts \
      tests/live/openrouter-fallback.live.test.ts \
      tests/live/google-preview-fallback.live.test.ts \
      tests/run-env.test.ts \
      tests/model-attempts.test.ts
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "test: delete provider-specific test files"
```

### Task 6.2: Write new run-env test

**Files:**

- Create: `tests/run-env.test.ts`

- [ ] **Step 1: Write basic env resolution tests**

```typescript
import { describe, expect, it } from "vitest";
import { resolveEnvState } from "../src/run/run-env.js";

describe("resolveEnvState", () => {
  const empty = {};

  it("returns defaults when no env or config", () => {
    const state = resolveEnvState({ env: empty, envForRun: empty, config: null });
    expect(state.litellmBaseUrl).toBe("http://10.10.10.10:4000");
    expect(state.litellmApiKey).toBeNull();
    expect(state.model).toBe("mistral/mistral-large-latest");
    expect(state.sttModel).toBe("mistral/voxtral-mini-latest");
  });

  it("reads LITELLM_BASE_URL from env", () => {
    const state = resolveEnvState({
      env: empty,
      envForRun: { LITELLM_BASE_URL: "http://localhost:4000" },
      config: null,
    });
    expect(state.litellmBaseUrl).toBe("http://localhost:4000");
  });

  it("reads LITELLM_API_KEY from env", () => {
    const state = resolveEnvState({
      env: empty,
      envForRun: { LITELLM_API_KEY: "sk-test" },
      config: null,
    });
    expect(state.litellmApiKey).toBe("sk-test");
  });

  it("reads model from SUMMARIZE_MODEL env", () => {
    const state = resolveEnvState({
      env: empty,
      envForRun: { SUMMARIZE_MODEL: "anthropic/claude-sonnet-4-6" },
      config: null,
    });
    expect(state.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("reads model from config", () => {
    const state = resolveEnvState({
      env: empty,
      envForRun: empty,
      config: { model: "openai/gpt-5-mini" },
    });
    expect(state.model).toBe("openai/gpt-5-mini");
  });

  it("env SUMMARIZE_MODEL overrides config model", () => {
    const state = resolveEnvState({
      env: empty,
      envForRun: { SUMMARIZE_MODEL: "from-env" },
      config: { model: "from-config" },
    });
    expect(state.model).toBe("from-env");
  });

  it("reads litellm config from config file", () => {
    const state = resolveEnvState({
      env: empty,
      envForRun: empty,
      config: { litellm: { baseUrl: "http://custom:8000", apiKey: "cfg-key" } },
    });
    expect(state.litellmBaseUrl).toBe("http://custom:8000");
    expect(state.litellmApiKey).toBe("cfg-key");
  });

  it("resolves firecrawl key", () => {
    const state = resolveEnvState({
      env: empty,
      envForRun: { FIRECRAWL_API_KEY: "fc-key" },
      config: null,
    });
    expect(state.firecrawlApiKey).toBe("fc-key");
    expect(state.firecrawlConfigured).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm vitest run tests/run-env.test.ts
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add tests/run-env.test.ts
git commit -m "test: add run-env tests for LiteLLM config resolution"
```

### Task 6.3: Fix remaining test compilation

- [ ] **Step 1: Run all tests to find failures**

```bash
pnpm vitest run 2>&1 | tail -40
```

- [ ] **Step 2: Fix test files that import deleted modules**

Common fixes:

- `tests/html-to-markdown.test.ts` — update mock to use new `createHtmlToMarkdownConverter` signature
- `tests/transcript-to-markdown.test.ts` — same pattern
- `tests/run.streaming.test.ts` — remove provider-specific streaming checks
- `tests/run.url-summary-flow.test.ts` — update to use simplified engine
- `tests/asset.summary-branches.test.ts` — remove model attempt mocking
- `tests/model-id.test.ts` — delete (model-id.ts is deleted)
- `tests/helpers/pi-ai-mock.ts` — check if still needed, simplify

- [ ] **Step 3: Run tests again until all pass**

```bash
pnpm vitest run
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: fix all remaining test compilation after LLM simplification"
```

---

## Chunk 7: Final Cleanup

### Task 7.1: Remove unused dependencies

- [ ] **Step 1: Check if any provider-specific packages can be removed**

```bash
grep -r "openrouter\|@google\|@anthropic\|nvidia" package.json
```

Note: `@mariozechner/pi-ai` likely bundles all provider support — it stays. But check for standalone provider packages.

- [ ] **Step 2: Remove unused packages if found**

```bash
pnpm remove <package-name>
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: remove unused provider dependencies"
```

### Task 7.2: Full build & test verification

- [ ] **Step 1: Run full build**

```bash
pnpm build
```

Expected: Clean build.

- [ ] **Step 2: Run full test suite**

```bash
pnpm vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Run check gate**

```bash
pnpm check
```

Expected: Clean.

### Task 7.3: Update config.json on server

This is a deployment task, not a code task. Document what needs to change:

- [ ] **Step 1: Document the new config format**

The server's `config.json` (at `/opt/apps/summarize/data/config.json`) needs updating:

**Before:**

```json
{
  "accounts": [...],
  "model": { "mode": "auto" },
  "openai": { ... },
  "apiKeys": { "openai": "...", "anthropic": "...", ... }
}
```

**After:**

```json
{
  "accounts": [...],
  "litellm": {
    "baseUrl": "http://10.10.10.10:4000"
  },
  "model": "mistral/mistral-large-latest",
  "sttModel": "mistral/voxtral-mini-latest"
}
```

API keys for Mistral are configured in LiteLLM, not in the app.

- [ ] **Step 2: Verify LiteLLM has Mistral configured**

SSH into the server and check LiteLLM config has:

- `mistral/mistral-large-latest` model with Mistral API key
- `mistral/voxtral-mini-latest` for transcription
- `/audio/transcriptions` endpoint enabled
