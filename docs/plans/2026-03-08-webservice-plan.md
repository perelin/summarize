# Summarize Web Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Hono-based HTTP API server for script/automation use, plus Mistral Voxtral as a transcription provider, deployed via Docker.

**Architecture:** New `src/server/` entrypoint using Hono that reuses existing daemon orchestration functions (`streamSummaryForUrl`, `streamSummaryForVisiblePage`) and core library. Mistral Voxtral added as a cloud transcription provider following the Groq pattern.

**Tech Stack:** Hono + @hono/node-server, TypeScript, Docker (node:22-slim + ffmpeg + yt-dlp)

---

## Task 1: Add Hono Dependencies

**Files:**

- Modify: `package.json`

**Step 1: Install dependencies**

Run: `pnpm add hono @hono/node-server`

**Step 2: Verify installation**

Run: `pnpm ls hono @hono/node-server`
Expected: Both packages listed with versions

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add hono and @hono/node-server dependencies"
```

---

## Task 2: Mistral Voxtral Transcription Provider

Template: `packages/core/src/transcription/whisper/groq.ts` (55 lines, exact pattern)

**Files:**

- Create: `packages/core/src/transcription/whisper/mistral.ts`
- Modify: `packages/core/src/transcription/whisper/cloud-providers.ts`
- Modify: `packages/core/src/transcription/whisper/remote-provider-attempts.ts`
- Modify: `packages/core/src/transcription/whisper/remote.ts`
- Modify: `packages/core/src/transcription/whisper/provider-setup.ts`
- Modify: `packages/core/src/transcription/whisper/core.ts`
- Modify: `packages/core/src/content/transcript/transcription-config.ts`
- Modify: `packages/core/src/content/link-preview/client.ts`
- Test: `tests/transcription.whisper.mistral.test.ts`
- Test: `tests/transcription.whisper.cloud-providers.test.ts` (update existing)

### Step 1: Write the Mistral provider test

Create `tests/transcription.whisper.mistral.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

describe("transcription/whisper mistral", () => {
  it("calls Mistral Voxtral and returns transcribed text", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as unknown;
      expect(body).toBeInstanceOf(FormData);

      const form = body as FormData;
      expect(form.get("model")).toBe("voxtral-mini-latest");

      const file = form.get("file") as unknown as { name?: unknown };
      expect(file).toBeTruthy();
      expect(file.name).toBe("audio.mp3");

      const url = typeof _input === "string" ? _input : _input.toString();
      expect(url).toBe("https://api.mistral.ai/v1/audio/transcriptions");

      return new Response(JSON.stringify({ text: "hello from mistral" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const { transcribeWithMistral } =
        await import("../packages/core/src/transcription/whisper/mistral.js");

      const result = await transcribeWithMistral(
        new Uint8Array([1, 2, 3]),
        "audio/mpeg",
        "audio.mp3",
        "test-mistral-key",
      );
      expect(result).toBe("hello from mistral");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns null when response has no text field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ foo: "bar" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    try {
      const { transcribeWithMistral } =
        await import("../packages/core/src/transcription/whisper/mistral.js");

      const result = await transcribeWithMistral(
        new Uint8Array([1, 2, 3]),
        "audio/mpeg",
        "audio.mp3",
        "test-key",
      );
      expect(result).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    try {
      const { transcribeWithMistral } =
        await import("../packages/core/src/transcription/whisper/mistral.js");

      await expect(
        transcribeWithMistral(new Uint8Array([1]), "audio/mpeg", "a.mp3", "key"),
      ).rejects.toThrow("Mistral transcription failed (429)");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm vitest run tests/transcription.whisper.mistral.test.ts`
Expected: FAIL — module not found

### Step 3: Create the Mistral provider

Create `packages/core/src/transcription/whisper/mistral.ts`:

```typescript
import { MAX_ERROR_DETAIL_CHARS, TRANSCRIPTION_TIMEOUT_MS } from "./constants.js";
import { ensureWhisperFilenameExtension, toArrayBuffer } from "./utils.js";

export async function transcribeWithMistral(
  bytes: Uint8Array,
  mediaType: string,
  filename: string | null,
  apiKey: string,
): Promise<string | null> {
  const form = new FormData();
  const providedName = filename?.trim() ? filename.trim() : "media";
  const safeName = ensureWhisperFilenameExtension(providedName, mediaType);
  form.append("file", new Blob([toArrayBuffer(bytes)], { type: mediaType }), safeName);
  form.append("model", "voxtral-mini-latest");

  const response = await globalThis.fetch("https://api.mistral.ai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    const suffix = detail ? `: ${detail}` : "";
    throw new Error(`Mistral transcription failed (${response.status})${suffix}`);
  }

  const payload = (await response.json()) as { text?: unknown };
  if (typeof payload?.text !== "string") return null;
  const trimmed = payload.text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed) return null;
    return trimmed.length > MAX_ERROR_DETAIL_CHARS
      ? `${trimmed.slice(0, MAX_ERROR_DETAIL_CHARS)}…`
      : trimmed;
  } catch {
    return null;
  }
}
```

### Step 4: Run the Mistral test

Run: `pnpm vitest run tests/transcription.whisper.mistral.test.ts`
Expected: PASS

### Step 5: Wire Mistral into the cloud provider chain

**Modify `packages/core/src/transcription/whisper/cloud-providers.ts`:**

Add `"mistral"` to `CloudProvider` type:

```typescript
export type CloudProvider = "assemblyai" | "mistral" | "gemini" | "openai" | "fal";
```

Add `mistralApiKey` to `CloudProviderKeyState`:

```typescript
type CloudProviderKeyState = {
  assemblyaiApiKey: string | null;
  mistralApiKey: string | null;
  geminiApiKey: string | null;
  openaiApiKey: string | null;
  falApiKey: string | null;
};
```

Add `hasMistral` to `CloudProviderAvailability`:

```typescript
type CloudProviderAvailability = {
  hasAssemblyAi: boolean;
  hasMistral: boolean;
  hasGemini: boolean;
  hasOpenai: boolean;
  hasFal: boolean;
};
```

Add Mistral descriptor to `CLOUD_PROVIDER_DESCRIPTORS` (after assemblyai, before gemini):

```typescript
{
  provider: "mistral",
  label: "Mistral",
  standaloneLabel: "Voxtral/Mistral",
  modelId: () => "voxtral-mini-latest",
},
```

Add to `resolveCloudProviderOrder` (after assemblyai, before gemini):

```typescript
if (state.mistralApiKey) order.push("mistral");
```

Add to `resolveCloudProviderOrderFromAvailability`:

```typescript
mistralApiKey: availability.hasMistral ? "1" : null,
```

**Modify `packages/core/src/transcription/whisper/remote-provider-attempts.ts`:**

Add import:

```typescript
import { transcribeWithMistral } from "./mistral.js";
```

Add `mistralApiKey` to `attemptRemoteBytesProvider` args and the `BYTE_PROVIDER_EXECUTORS` type.

Add mistral executor to `BYTE_PROVIDER_EXECUTORS`:

```typescript
mistral: async ({ state, mistralApiKey }) => {
  try {
    const text = await transcribeWithMistral(state.bytes, state.mediaType, state.filename, mistralApiKey!);
    if (text) {
      return {
        state,
        result: { text, provider: "mistral", error: null, notes: [] },
        error: null,
      };
    }
    return { state, result: null, error: new Error("Mistral transcription returned empty text") };
  } catch (caught) {
    return {
      state,
      result: null,
      error: caught instanceof Error ? caught : wrapError("Mistral transcription failed", caught),
    };
  }
},
```

**Modify `packages/core/src/transcription/whisper/remote.ts`:**

Add `mistralApiKey: string | null` to the `CloudArgs` type and thread it through `transcribeBytesAcrossProviders`, `transcribeBytesWithRemoteFallbacks`, and `transcribeFileWithRemoteFallbacks` (both function signatures and the calls to `resolveCloudProviderOrder` and `attemptRemoteBytesProvider`).

**Modify `packages/core/src/transcription/whisper/provider-setup.ts`:**

Add `MISTRAL_API_KEY` to `TRANSCRIPTION_PROVIDER_ENV_LIST` and `TRANSCRIPTION_PROVIDER_ENV_LABEL`.

Add resolver:

```typescript
export function resolveMistralApiKey({
  env,
  mistralApiKey,
}: {
  env?: Env;
  mistralApiKey?: string | null;
}): string | null {
  const explicit = normalizeApiKey(mistralApiKey);
  if (explicit) return explicit;
  const source = env ?? process.env;
  return normalizeApiKey(source.MISTRAL_API_KEY);
}
```

**Modify `packages/core/src/transcription/whisper/core.ts`:**

Add `mistralApiKey` to the `MediaRequest` type and thread it through to `transcribeBytesWithRemoteFallbacks` and `transcribeFileWithRemoteFallbacks` calls.

**Modify `packages/core/src/content/transcript/transcription-config.ts`:**

Add `mistralApiKey: string | null` to `TranscriptionConfig` type.
Add `mistralApiKey` to `TranscriptionConfigInput`.
Import and call `resolveMistralApiKey` in `resolveTranscriptionConfig`.

**Modify `packages/core/src/content/link-preview/client.ts`:**

Add `mistralApiKey?: string | null` to `LinkPreviewClientOptions`.
Resolve and pass through to transcription config.

### Step 6: Update existing cloud-providers test

In `tests/transcription.whisper.cloud-providers.test.ts`, add `mistralApiKey` to all `resolveCloudProviderOrder` calls, add `hasMistral` to all `buildCloudProviderHint` and `buildCloudModelIdChain` calls, and update expected values to include `"mistral"` in the chain after `"assemblyai"`.

### Step 7: Run all transcription tests

Run: `pnpm vitest run tests/transcription.whisper`
Expected: All PASS

### Step 8: Commit

```bash
git add packages/core/src/transcription/ packages/core/src/content/ tests/transcription.whisper.*
git commit -m "feat: add Mistral Voxtral as cloud transcription provider"
```

---

## Task 3: Expose report from daemon summarize functions

The `streamSummaryForUrl` and `streamSummaryForVisiblePage` in `src/daemon/summarize.ts` compute a `RunMetricsReport` internally but don't return it. We need it for the API response's `usage` field.

**Files:**

- Modify: `src/daemon/summarize.ts`

### Step 1: Add `report` to both return values

In `streamSummaryForVisiblePage` (around line 280), change the return to also include `report`:

```typescript
return {
  usedModel: modelLabel,
  report,
  metrics: buildDaemonMetrics({ ... }),
};
```

In `streamSummaryForUrl` (around line 416), same change:

```typescript
return {
  usedModel: modelLabel,
  report,
  metrics: buildDaemonMetrics({ ... }),
};
```

Also export the `RunMetricsReport` type from the module (it's already imported from `../costs.js`).

### Step 2: Verify nothing breaks

Run: `pnpm vitest run`
Expected: All tests PASS (additive change only)

### Step 3: Commit

```bash
git add src/daemon/summarize.ts
git commit -m "feat: expose RunMetricsReport from daemon summarize functions"
```

---

## Task 4: Server Types and Utilities

**Files:**

- Create: `src/server/types.ts`
- Create: `src/server/utils/length-map.ts`

### Step 1: Create types

Create `src/server/types.ts`:

```typescript
export type ApiLength = "tiny" | "short" | "medium" | "long" | "xlarge";

export type SummarizeJsonBody = {
  url?: string;
  text?: string;
  length?: ApiLength;
  model?: string;
  extract?: boolean;
};

export type SummarizeResponse = {
  summary: string;
  metadata: {
    title: string | null;
    source: string;
    model: string;
    usage: { inputTokens: number; outputTokens: number } | null;
    durationMs: number;
  };
};

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};
```

### Step 2: Create length mapping

Create `src/server/utils/length-map.ts`:

```typescript
import type { ApiLength } from "../types.js";

const LENGTH_MAP: Record<ApiLength, string> = {
  tiny: "400",
  short: "short",
  medium: "medium",
  long: "long",
  xlarge: "xxl",
};

const VALID_LENGTHS = new Set<string>(Object.keys(LENGTH_MAP));

export function mapApiLength(input?: string): string {
  if (!input) return "medium";
  if (!VALID_LENGTHS.has(input)) {
    throw new Error(`Invalid length: ${input}. Must be one of: ${[...VALID_LENGTHS].join(", ")}`);
  }
  return LENGTH_MAP[input as ApiLength];
}
```

### Step 3: Verify build

Run: `pnpm tsc --noEmit`
Expected: No type errors

### Step 4: Commit

```bash
git add src/server/
git commit -m "feat: add API server types and length mapping"
```

---

## Task 5: Auth Middleware

**Files:**

- Create: `src/server/middleware/auth.ts`
- Test: `tests/server.auth.test.ts`

### Step 1: Write auth test

Create `tests/server.auth.test.ts`:

```typescript
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { authMiddleware } from "../src/server/middleware/auth.js";

function createTestApp(token: string | null) {
  const app = new Hono();
  app.use("*", authMiddleware(token));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("auth middleware", () => {
  it("rejects when no token configured", async () => {
    const app = createTestApp(null);
    const res = await app.request("/test");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_ERROR");
  });

  it("rejects missing Authorization header", async () => {
    const app = createTestApp("secret");
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("rejects wrong token", async () => {
    const app = createTestApp("secret");
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts correct token", async () => {
    const app = createTestApp("secret");
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm vitest run tests/server.auth.test.ts`
Expected: FAIL — module not found

### Step 3: Implement auth middleware

Create `src/server/middleware/auth.ts`:

```typescript
import { createMiddleware } from "hono/factory";

export function authMiddleware(token: string | null) {
  return createMiddleware(async (c, next) => {
    if (!token) {
      return c.json({ error: { code: "SERVER_ERROR", message: "API token not configured" } }, 500);
    }
    const header = c.req.header("Authorization");
    const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!bearer || bearer !== token) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid or missing bearer token" } },
        401,
      );
    }
    await next();
  });
}
```

### Step 4: Run test

Run: `pnpm vitest run tests/server.auth.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/server/middleware/ tests/server.auth.test.ts
git commit -m "feat: add bearer token auth middleware for API server"
```

---

## Task 6: Health Route

**Files:**

- Create: `src/server/routes/health.ts`
- Test: `tests/server.health.test.ts`

### Step 1: Write test

Create `tests/server.health.test.ts`:

```typescript
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { healthRoute } from "../src/server/routes/health.js";

describe("GET /v1/health", () => {
  it("returns ok", async () => {
    const app = new Hono();
    app.route("/v1", healthRoute);
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm vitest run tests/server.health.test.ts`
Expected: FAIL

### Step 3: Implement

Create `src/server/routes/health.ts`:

```typescript
import { Hono } from "hono";

export const healthRoute = new Hono();

healthRoute.get("/health", (c) => c.json({ status: "ok" }));
```

### Step 4: Run test

Run: `pnpm vitest run tests/server.health.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/server/routes/health.ts tests/server.health.test.ts
git commit -m "feat: add /v1/health endpoint"
```

---

## Task 7: Summarize Route (URL + Text modes)

This is the core task. File upload (Task 8) is separate.

**Files:**

- Create: `src/server/routes/summarize.ts`
- Test: `tests/server.summarize.test.ts`

### Step 1: Write route tests (mocked)

Create `tests/server.summarize.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { Hono } from "hono";

// We'll test the full route with mocked dependencies in integration tests.
// Unit tests focus on input validation.

describe("POST /v1/summarize validation", () => {
  it("rejects empty JSON body", async () => {
    const { createSummarizeRoute } = await import("../src/server/routes/summarize.js");
    const route = createSummarizeRoute({
      env: {},
      config: null,
      cache: null as any,
      mediaCache: null,
    });
    const app = new Hono();
    app.route("/v1", route);

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects invalid length", async () => {
    const { createSummarizeRoute } = await import("../src/server/routes/summarize.js");
    const route = createSummarizeRoute({
      env: {},
      config: null,
      cache: null as any,
      mediaCache: null,
    });
    const app = new Hono();
    app.route("/v1", route);

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", length: "gigantic" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("Invalid length");
  });

  it("rejects non-http URL", async () => {
    const { createSummarizeRoute } = await import("../src/server/routes/summarize.js");
    const route = createSummarizeRoute({
      env: {},
      config: null,
      cache: null as any,
      mediaCache: null,
    });
    const app = new Hono();
    app.route("/v1", route);

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "ftp://example.com" }),
    });
    expect(res.status).toBe(400);
  });
});
```

### Step 2: Run test to verify failure

Run: `pnpm vitest run tests/server.summarize.test.ts`
Expected: FAIL

### Step 3: Implement summarize route

Create `src/server/routes/summarize.ts`:

```typescript
import { Hono } from "hono";
import type { CacheState } from "../../cache.js";
import type { SummarizeConfig } from "../../config.js";
import type { MediaCache } from "../../content/index.js";
import type { RunOverrides } from "../../run/run-settings.js";
import {
  extractContentForUrl,
  streamSummaryForUrl,
  streamSummaryForVisiblePage,
  type StreamSink,
} from "../../daemon/summarize.js";
import { mapApiLength } from "../utils/length-map.js";
import type { SummarizeJsonBody, SummarizeResponse, ApiError } from "../types.js";

export type SummarizeRouteDeps = {
  env: Record<string, string | undefined>;
  config: SummarizeConfig | null;
  cache: CacheState;
  mediaCache: MediaCache | null;
};

const DEFAULT_OVERRIDES: RunOverrides = {
  firecrawlMode: null,
  markdownMode: null,
  preprocessMode: null,
  youtubeMode: null,
  videoMode: null,
  transcriptTimestamps: null,
  forceSummary: null,
  timeoutMs: null,
  retries: null,
  maxOutputTokensArg: null,
  transcriber: null,
  autoCliFallbackEnabled: null,
  autoCliOrder: null,
};

export function createSummarizeRoute(deps: SummarizeRouteDeps) {
  const route = new Hono();

  route.post("/summarize", async (c) => {
    // Parse body — JSON or multipart
    const contentType = c.req.header("Content-Type") ?? "";
    let body: SummarizeJsonBody;

    if (contentType.includes("multipart/form-data")) {
      // File upload handled in Task 8
      return c.json<ApiError>(
        { error: { code: "NOT_IMPLEMENTED", message: "File upload not yet supported" } },
        501,
      );
    }

    try {
      body = await c.req.json<SummarizeJsonBody>();
    } catch {
      return c.json<ApiError>(
        { error: { code: "INVALID_INPUT", message: "Invalid JSON body" } },
        400,
      );
    }

    // Validate: must have url or text
    if (!body.url && !body.text) {
      return c.json<ApiError>(
        { error: { code: "INVALID_INPUT", message: "Must provide url or text" } },
        400,
      );
    }

    // Validate length
    let lengthRaw: string;
    try {
      lengthRaw = mapApiLength(body.length);
    } catch (err) {
      return c.json<ApiError>(
        { error: { code: "INVALID_INPUT", message: (err as Error).message } },
        400,
      );
    }

    // Validate URL
    if (body.url) {
      try {
        const parsed = new URL(body.url);
        if (!parsed.protocol.startsWith("http")) {
          return c.json<ApiError>(
            { error: { code: "INVALID_INPUT", message: "URL must use http or https" } },
            400,
          );
        }
      } catch {
        return c.json<ApiError>({ error: { code: "INVALID_INPUT", message: "Invalid URL" } }, 400);
      }
    }

    // Collect streamed chunks
    const chunks: string[] = [];
    const sink: StreamSink = {
      writeChunk: (text) => chunks.push(text),
      onModelChosen: () => {},
    };

    const startedAt = Date.now();

    try {
      if (body.url && body.extract) {
        // Extract-only mode
        const { extracted } = await extractContentForUrl({
          env: deps.env,
          fetchImpl: globalThis.fetch,
          input: { url: body.url, title: null, maxCharacters: null },
          cache: deps.cache,
          mediaCache: deps.mediaCache,
          overrides: DEFAULT_OVERRIDES,
        });

        return c.json<SummarizeResponse>({
          summary: extracted.content,
          metadata: {
            title: extracted.title ?? null,
            source: body.url,
            model: "none",
            usage: null,
            durationMs: Date.now() - startedAt,
          },
        });
      }

      if (body.url) {
        // URL mode
        const result = await streamSummaryForUrl({
          env: deps.env,
          fetchImpl: globalThis.fetch,
          input: { url: body.url, title: null, maxCharacters: null },
          modelOverride: body.model ?? null,
          promptOverride: null,
          lengthRaw,
          languageRaw: "",
          sink,
          cache: deps.cache,
          mediaCache: deps.mediaCache,
          overrides: DEFAULT_OVERRIDES,
        });

        const usage = result.report?.llm?.[0]
          ? {
              inputTokens: result.report.llm[0].promptTokens ?? 0,
              outputTokens: result.report.llm[0].completionTokens ?? 0,
            }
          : null;

        return c.json<SummarizeResponse>({
          summary: chunks.join(""),
          metadata: {
            title: null,
            source: body.url,
            model: result.usedModel,
            usage,
            durationMs: result.metrics.elapsedMs,
          },
        });
      }

      // Text mode
      const result = await streamSummaryForVisiblePage({
        env: deps.env,
        fetchImpl: globalThis.fetch,
        input: {
          url: "text://input",
          title: null,
          text: body.text!,
          truncated: false,
        },
        modelOverride: body.model ?? null,
        promptOverride: null,
        lengthRaw,
        languageRaw: "",
        sink,
        cache: deps.cache,
        mediaCache: deps.mediaCache,
        overrides: DEFAULT_OVERRIDES,
      });

      const usage = result.report?.llm?.[0]
        ? {
            inputTokens: result.report.llm[0].promptTokens ?? 0,
            outputTokens: result.report.llm[0].completionTokens ?? 0,
          }
        : null;

      return c.json<SummarizeResponse>({
        summary: chunks.join(""),
        metadata: {
          title: null,
          source: "text",
          model: result.usedModel,
          usage,
          durationMs: result.metrics.elapsedMs,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      const isTimeout =
        message.toLowerCase().includes("timed out") || message.toLowerCase().includes("timeout");
      return c.json<ApiError>(
        { error: { code: isTimeout ? "TIMEOUT" : "INTERNAL_ERROR", message } },
        isTimeout ? 504 : 500,
      );
    }
  });

  return route;
}
```

### Step 4: Run tests

Run: `pnpm vitest run tests/server.summarize.test.ts`
Expected: PASS (validation tests)

### Step 5: Verify types compile

Run: `pnpm tsc --noEmit`
Expected: No errors

### Step 6: Commit

```bash
git add src/server/routes/summarize.ts tests/server.summarize.test.ts
git commit -m "feat: add POST /v1/summarize endpoint (URL + text modes)"
```

---

## Task 8: Summarize Route — File Upload Mode

**Files:**

- Modify: `src/server/routes/summarize.ts`

### Step 1: Add file upload handling

In the `createSummarizeRoute` function, replace the `NOT_IMPLEMENTED` multipart branch with actual file upload handling:

```typescript
if (contentType.includes("multipart/form-data")) {
  const formData = await c.req.parseBody();
  const file = formData.file;

  if (!file || typeof file === "string") {
    return c.json<ApiError>(
      { error: { code: "INVALID_INPUT", message: "Must provide a file field" } },
      400,
    );
  }

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  if (file.size > MAX_FILE_SIZE) {
    return c.json<ApiError>(
      {
        error: {
          code: "FILE_TOO_LARGE",
          message: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
        },
      },
      413,
    );
  }

  let lengthRaw: string;
  try {
    lengthRaw = mapApiLength(typeof formData.length === "string" ? formData.length : undefined);
  } catch (err) {
    return c.json<ApiError>(
      { error: { code: "INVALID_INPUT", message: (err as Error).message } },
      400,
    );
  }

  const modelOverride = typeof formData.model === "string" ? formData.model : null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = file.name || "upload";
  const mediaType = file.type || "application/octet-stream";

  // Write to temp file for asset loading
  const { randomUUID } = await import("node:crypto");
  const { writeFile, unlink } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const tempPath = join(tmpdir(), `summarize-api-${randomUUID()}`);
  try {
    await writeFile(tempPath, bytes);

    // Use loadLocalAsset to classify and handle the file
    const { loadLocalAsset } = await import("../../content/asset.js");
    const { sourceLabel, attachment } = await loadLocalAsset({ filePath: tempPath });

    // Build prompt and summarize based on asset type
    const { buildFileSummaryPrompt } = await import("../../prompts/index.js");
    // ... (implementation details depend on asset type — media files go through transcription,
    //      text/PDF files go through direct LLM summarization)
    // For POC: delegate to the appropriate flow based on mediaType

    return c.json<ApiError>(
      { error: { code: "NOT_IMPLEMENTED", message: "File upload flow coming in next iteration" } },
      501,
    );
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}
```

**Note:** Full file upload implementation requires deeper integration with the asset flow (`summarizeAsset` from `src/daemon/flow-context.ts`). For the POC, this task stubs the multipart parsing and temp file handling. Full asset summarization is a follow-up task once URL + text modes are validated.

### Step 2: Commit

```bash
git add src/server/routes/summarize.ts
git commit -m "feat: add file upload parsing to /v1/summarize (stub)"
```

---

## Task 9: App Composition and Entry Point

**Files:**

- Create: `src/server/index.ts`
- Create: `src/server/main.ts`

### Step 1: Create app factory

Create `src/server/index.ts`:

```typescript
import { Hono } from "hono";
import { authMiddleware } from "./middleware/auth.js";
import { healthRoute } from "./routes/health.js";
import { createSummarizeRoute, type SummarizeRouteDeps } from "./routes/summarize.js";

export type ServerDeps = SummarizeRouteDeps & {
  apiToken: string | null;
};

export function createApp(deps: ServerDeps) {
  const app = new Hono();

  // Health — no auth
  app.route("/v1", healthRoute);

  // Protected routes
  const summarizeRoute = createSummarizeRoute(deps);
  app.use("/v1/summarize", authMiddleware(deps.apiToken));
  app.route("/v1", summarizeRoute);

  // Global error handler
  app.onError((err, c) => {
    console.error("[summarize-api]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    const isTimeout = message.toLowerCase().includes("timeout");
    return c.json(
      { error: { code: isTimeout ? "TIMEOUT" : "INTERNAL_ERROR", message } },
      isTimeout ? 504 : 500,
    );
  });

  return app;
}
```

### Step 2: Create entry point

Create `src/server/main.ts`:

```typescript
import { serve } from "@hono/node-server";
import { loadSummarizeConfig } from "../config.js";
import { createCacheStateFromConfig } from "../run/cache-state.js";
import { createMediaCacheFromConfig } from "../run/media-cache-state.js";
import { createApp } from "./index.js";

const env = { ...process.env };
const port = Number(env.SUMMARIZE_API_PORT) || 3000;
const apiToken = env.SUMMARIZE_API_TOKEN?.trim() || null;

if (!apiToken) {
  console.error("SUMMARIZE_API_TOKEN is required. Set it as an environment variable.");
  process.exit(1);
}

const { config } = loadSummarizeConfig({ env });
const cache = await createCacheStateFromConfig({ envForRun: env, config, noCacheFlag: false });
const mediaCache = await createMediaCacheFromConfig({ envForRun: env, config });

const app = createApp({ env, config, cache, mediaCache, apiToken });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[summarize-api] Listening on http://0.0.0.0:${info.port}`);
});

// Graceful shutdown
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[summarize-api] ${signal} received, shutting down...`);
    server.close(() => process.exit(0));
  });
}
```

### Step 3: Add dev script to package.json

Add to `scripts` in `package.json`:

```json
"server": "tsx src/server/main.ts",
"server:dev": "tsx watch src/server/main.ts"
```

### Step 4: Verify types compile

Run: `pnpm tsc --noEmit`

### Step 5: Commit

```bash
git add src/server/index.ts src/server/main.ts package.json
git commit -m "feat: add API server entry point and app composition"
```

---

## Task 10: Dockerfile

**Files:**

- Create: `Dockerfile`

Reference: `Dockerfile.test` (existing)

### Step 1: Create Dockerfile

Create `Dockerfile`:

```dockerfile
# Stage 1: Build
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY packages/ ./packages/

# Remove prepare script to prevent build before full source is copied
RUN sed -i 's/"prepare":.*,//' package.json

RUN CI=true pnpm install --frozen-lockfile

COPY src/ ./src/
COPY scripts/ ./scripts/

RUN pnpm build

# Stage 2: Runtime
FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist/ ./packages/core/dist/

# Remove prepare script for prod install
RUN sed -i 's/"prepare":.*,//' package.json

RUN CI=true pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist/ ./dist/

ENV SUMMARIZE_API_PORT=3000
EXPOSE 3000

CMD ["node", "dist/esm/server/main.js"]
```

### Step 2: Build and verify

Run: `docker build -t summarize-api .`
Expected: Successful build

### Step 3: Test

Run:

```bash
docker run --rm -e SUMMARIZE_API_TOKEN=test-token -p 3000:3000 summarize-api &
sleep 2
curl http://localhost:3000/v1/health
# Expected: {"status":"ok"}
docker stop $(docker ps -q --filter ancestor=summarize-api)
```

### Step 4: Commit

```bash
git add Dockerfile
git commit -m "feat: add production Dockerfile for API server"
```

---

## Task 11: End-to-End Verification

No new files. This is a manual verification task.

### Step 1: Build

Run: `pnpm build`
Expected: Clean build, dist/ includes server/main.js

### Step 2: Run all tests

Run: `pnpm vitest run`
Expected: All tests PASS

### Step 3: Start server locally

Run: `SUMMARIZE_API_TOKEN=test ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY pnpm server`
Expected: `[summarize-api] Listening on http://0.0.0.0:3000`

### Step 4: Test health

Run: `curl http://localhost:3000/v1/health`
Expected: `{"status":"ok"}`

### Step 5: Test auth rejection

Run: `curl -s -w "\n%{http_code}" http://localhost:3000/v1/summarize -X POST -H "Content-Type: application/json" -d '{"url":"https://example.com"}'`
Expected: 401

### Step 6: Test URL summarization

Run:

```bash
curl -s http://localhost:3000/v1/summarize \
  -H "Authorization: Bearer test" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","length":"tiny"}'
```

Expected: JSON response with `summary` and `metadata` fields

### Step 7: Test text summarization

Run:

```bash
curl -s http://localhost:3000/v1/summarize \
  -H "Authorization: Bearer test" \
  -H "Content-Type: application/json" \
  -d '{"text":"The quick brown fox jumps over the lazy dog. This is a test of the summarization API. It should return a summary of this text.","length":"short"}'
```

Expected: JSON response with summary

### Step 8: Docker build + test

Run:

```bash
docker build -t summarize-api .
docker run --rm -d -p 3001:3000 \
  -e SUMMARIZE_API_TOKEN=test \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  --name summarize-api-test \
  summarize-api
sleep 3
curl http://localhost:3001/v1/health
docker stop summarize-api-test
```
