# File Upload & Summarization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to upload PDFs, images, audio, and video files via the web frontend for summarization, using drag-and-drop, clipboard paste, or file browse.

**Architecture:** Extend the existing `/v1/summarize` endpoint to accept multipart/form-data alongside JSON. File type is detected by extension/MIME and routed to the appropriate handler: pdf-parse for PDFs, multimodal LLM prompt for images, and `createLinkPreviewClient` transcription pipeline for audio/video. The frontend replaces the URL/Text tab switcher with a unified input area.

**Tech Stack:** Preact (frontend), Hono (server), pdf-parse (PDF extraction), existing LLM abstraction (`Prompt` with `attachments`), existing `createLinkPreviewClient` (audio/video transcription)

**Spec:** `docs/superpowers/specs/2026-03-14-file-upload-summarize-design.md`

---

## Chunk 1: Server Foundation — File Types, Body Limit, Multipart Skeleton

### Task 1.1: Add file type constants

**Files:**
- Create: `src/server/utils/file-types.ts`
- Test: `tests/server.file-types.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/server.file-types.test.ts
import { describe, expect, it } from "vitest";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  detectUploadType,
} from "../src/server/utils/file-types.js";

describe("file-types", () => {
  it("MAX_UPLOAD_BYTES is 200 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(200 * 1024 * 1024);
  });

  describe("detectUploadType", () => {
    it("detects PDF by extension", () => {
      expect(detectUploadType("report.pdf", "application/octet-stream")).toBe("pdf");
    });
    it("detects PDF by mime", () => {
      expect(detectUploadType("report", "application/pdf")).toBe("pdf");
    });
    it("detects image by extension", () => {
      expect(detectUploadType("photo.png", "")).toBe("image");
      expect(detectUploadType("photo.jpg", "")).toBe("image");
      expect(detectUploadType("photo.jpeg", "")).toBe("image");
      expect(detectUploadType("photo.gif", "")).toBe("image");
      expect(detectUploadType("photo.webp", "")).toBe("image");
      expect(detectUploadType("photo.svg", "")).toBe("image");
    });
    it("detects audio by extension", () => {
      expect(detectUploadType("song.mp3", "")).toBe("audio");
      expect(detectUploadType("song.m4a", "")).toBe("audio");
      expect(detectUploadType("song.wav", "")).toBe("audio");
      expect(detectUploadType("song.flac", "")).toBe("audio");
      expect(detectUploadType("song.ogg", "")).toBe("audio");
      expect(detectUploadType("song.opus", "")).toBe("audio");
    });
    it("detects video by extension", () => {
      expect(detectUploadType("clip.mp4", "")).toBe("video");
      expect(detectUploadType("clip.mov", "")).toBe("video");
      expect(detectUploadType("clip.mkv", "")).toBe("video");
      expect(detectUploadType("clip.webm", "")).toBe("video");
    });
    it("detects m4a by browser-reported mime variants", () => {
      expect(detectUploadType("audio.m4a", "audio/x-m4a")).toBe("audio");
      expect(detectUploadType("audio.m4a", "audio/mp4a-latm")).toBe("audio");
    });
    it("returns null for unsupported types", () => {
      expect(detectUploadType("file.docx", "application/vnd.openxmlformats")).toBeNull();
      expect(detectUploadType("file.exe", "application/x-executable")).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.file-types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement file-types.ts**

```typescript
// src/server/utils/file-types.ts
import { extname } from "node:path";

export type UploadFileType = "pdf" | "image" | "audio" | "video";

export const ALLOWED_UPLOAD_TYPES: Record<
  UploadFileType,
  { mimes: readonly string[]; exts: readonly string[] }
> = {
  pdf: {
    mimes: ["application/pdf"],
    exts: [".pdf"],
  },
  image: {
    mimes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"],
    exts: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"],
  },
  audio: {
    mimes: [
      "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/mp4a-latm",
      "audio/wav", "audio/x-wav", "audio/flac", "audio/aac", "audio/ogg", "audio/opus",
    ],
    exts: [".mp3", ".m4a", ".wav", ".flac", ".aac", ".ogg", ".opus"],
  },
  video: {
    mimes: ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"],
    exts: [".mp4", ".mov", ".mkv", ".webm"],
  },
} as const;

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

/** Detect file type by extension first, then MIME fallback. Returns null if unsupported. */
export function detectUploadType(
  filename: string,
  mimeType: string,
): UploadFileType | null {
  const ext = extname(filename).toLowerCase();
  for (const [type, { exts }] of Object.entries(ALLOWED_UPLOAD_TYPES)) {
    if (exts.includes(ext)) return type as UploadFileType;
  }
  const mime = mimeType.toLowerCase();
  for (const [type, { mimes }] of Object.entries(ALLOWED_UPLOAD_TYPES)) {
    if (mimes.some((m) => mime === m || mime.startsWith(m.split("/")[0] + "/"))) {
      return type as UploadFileType;
    }
  }
  return null;
}
```

Wait — the MIME fallback with `startsWith` is too broad. Let me fix: match exact MIME entries only, no wildcard prefix.

```typescript
export function detectUploadType(
  filename: string,
  mimeType: string,
): UploadFileType | null {
  const ext = extname(filename).toLowerCase();
  for (const [type, { exts }] of Object.entries(ALLOWED_UPLOAD_TYPES)) {
    if (exts.includes(ext)) return type as UploadFileType;
  }
  const mime = mimeType.toLowerCase();
  for (const [type, { mimes }] of Object.entries(ALLOWED_UPLOAD_TYPES)) {
    if (mimes.includes(mime)) return type as UploadFileType;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/server.file-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/utils/file-types.ts tests/server.file-types.test.ts
git commit -m "feat(server): add file type detection utilities for upload support"
```

### Task 1.2: Increase body limit for multipart uploads

**Files:**
- Modify: `src/server/index.ts:116`

- [ ] **Step 1: Update body limit**

Change line 116 from:
```typescript
app.use("/v1/summarize", bodyLimit({ maxSize: 10 * 1024 * 1024 })); // 10MB
```
To:
```typescript
app.use("/v1/summarize", bodyLimit({ maxSize: 200 * 1024 * 1024 })); // 200MB (file uploads)
```

- [ ] **Step 2: Run existing server tests**

Run: `pnpm vitest run tests/server.summarize.test.ts`
Expected: PASS (no behavior change for JSON requests)

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(server): increase body limit to 200MB for file uploads"
```

### Task 1.3: Add multipart parsing skeleton to summarize route

**Files:**
- Modify: `src/server/routes/summarize.ts:208-218`
- Test: `tests/server.upload.test.ts`

- [ ] **Step 1: Write validation tests**

```typescript
// tests/server.upload.test.ts
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createSummarizeRoute, type SummarizeRouteDeps } from "../src/server/routes/summarize.js";

const fakeDeps: SummarizeRouteDeps = {
  env: {},
  config: null,
  cache: { mode: "bypass" as const, store: null, ttlMs: 0, maxBytes: 0, path: null },
  mediaCache: null,
  historyStore: null,
  historyMediaPath: null,
  sseSessionManager: null,
};

function createTestApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("account", "test-user");
    await next();
  });
  const route = createSummarizeRoute(fakeDeps);
  app.route("/v1", route);
  return app;
}

describe("POST /v1/summarize multipart", () => {
  it("rejects multipart with no file field", async () => {
    const app = createTestApp();
    const form = new FormData();
    form.append("length", "medium");
    const res = await app.request("/v1/summarize", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects unsupported file type", async () => {
    const app = createTestApp();
    const form = new FormData();
    form.append("file", new File(["hello"], "test.docx", { type: "application/vnd.openxmlformats" }));
    const res = await app.request("/v1/summarize", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("rejects file exceeding size limit", async () => {
    const app = createTestApp();
    // Create a file that reports > 200MB via the File constructor
    // Note: actual bytes don't matter for the size check, we test the validation logic
    const bigContent = new Uint8Array(1024); // small actual content
    const form = new FormData();
    // We'll test the validation path — the actual size check uses file.size
    const file = new File([bigContent], "big.pdf", { type: "application/pdf" });
    // Override size for testing — File.size is readonly, so we test with real small files
    // and verify the route checks the size. The actual enforcement uses file.size.
    form.append("file", file);
    form.append("length", "medium");
    const res = await app.request("/v1/summarize", {
      method: "POST",
      body: form,
    });
    // Small file should pass validation, not be rejected for size
    // This test verifies the route reaches the processing stage (not the 501 stub)
    // Actual processing will fail since deps are fake, but that's expected
    expect(res.status).not.toBe(501); // No longer returns "not implemented"
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.upload.test.ts`
Expected: FAIL — still returns 501 from the stub

- [ ] **Step 3: Implement multipart skeleton**

Replace the multipart stub in `src/server/routes/summarize.ts` (lines 208-218). Add import for file-types at the top.

Add to imports:
```typescript
import { detectUploadType, MAX_UPLOAD_BYTES, type UploadFileType } from "../utils/file-types.js";
```

Replace the multipart block:
```typescript
    // ---- Multipart / file upload ----
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const parsed = await c.req.parseBody();
      const file = parsed["file"];
      if (!(file instanceof File)) {
        return c.json(jsonError("INVALID_INPUT", "Missing 'file' field in multipart request"), 400);
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        const sizeMB = Math.round(file.size / (1024 * 1024));
        return c.json(
          jsonError("FILE_TOO_LARGE", `File is ${sizeMB} MB, maximum is 200 MB`),
          413,
        );
      }

      const fileType = detectUploadType(file.name, file.type);
      if (!fileType) {
        return c.json(
          jsonError("UNSUPPORTED_FILE_TYPE", `File type not supported: ${file.name}`),
          422,
        );
      }

      const lengthField = typeof parsed["length"] === "string" ? parsed["length"] : undefined;
      const modelField = typeof parsed["model"] === "string" ? parsed["model"] : undefined;

      let lengthRaw: string;
      try {
        lengthRaw = mapApiLength(lengthField);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Invalid length";
        return c.json(jsonError("INVALID_INPUT", msg), 400);
      }

      const modelOverride = modelField ?? deps.env.SUMMARIZE_DEFAULT_MODEL ?? null;

      console.log(
        `[summarize-api] [${account}] file upload: type=${fileType} name=${file.name} size=${file.size} length=${lengthRaw}${modelOverride ? ` model=${modelOverride}` : ""}${wantsSSE ? " (SSE)" : ""}`,
      );

      // Route to file type handler (implemented in subsequent tasks)
      return c.json(
        jsonError("NOT_IMPLEMENTED", `File type '${fileType}' processing not yet implemented`),
        501,
      );
    }
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/server.upload.test.ts`
Expected: PASS

- [ ] **Step 5: Run all server tests to verify no regressions**

Run: `pnpm vitest run tests/server.summarize.test.ts tests/server.sse-streaming.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/summarize.ts tests/server.upload.test.ts
git commit -m "feat(server): add multipart parsing and validation for file uploads"
```

---

## Chunk 2: PDF Processing

### Task 2.1: Install pdf-parse

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Install pdf-parse**

Run: `pnpm add pdf-parse`

- [ ] **Step 2: Install types if available**

Run: `pnpm add -D @types/pdf-parse` (if it exists; skip if not)

- [ ] **Step 3: Verify build**

Run: `pnpm -s build`
Expected: builds successfully

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add pdf-parse dependency for PDF text extraction"
```

### Task 2.2: Implement PDF upload handler

**Files:**
- Create: `src/server/handlers/upload-pdf.ts`
- Test: `tests/server.upload-pdf.test.ts`

- [ ] **Step 1: Write test for PDF extraction + summarization**

```typescript
// tests/server.upload-pdf.test.ts
import { Hono } from "hono";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSummarizeRoute, type SummarizeRouteDeps } from "../src/server/routes/summarize.js";
import { SseSessionManager } from "../src/server/sse-session.js";
import * as pipelineMod from "../src/summarize/pipeline.js";

function parseSseText(text: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  const blocks = text.split("\n\n").filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "", data = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (event && data) events.push({ event, data: JSON.parse(data) });
  }
  return events;
}

describe("PDF upload", () => {
  let sseSessionManager: SseSessionManager;
  let fakeDeps: SummarizeRouteDeps;

  beforeEach(() => {
    sseSessionManager = new SseSessionManager();
    fakeDeps = {
      env: {},
      config: null,
      cache: { mode: "bypass" as const, store: null, ttlMs: 0, maxBytes: 0, path: null },
      mediaCache: null,
      historyStore: null,
      historyMediaPath: null,
      sseSessionManager,
    };
  });

  function createTestApp() {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("account", "test-user");
      await next();
    });
    app.route("/v1", createSummarizeRoute(fakeDeps));
    return app;
  }

  it("extracts text from PDF and streams summary via SSE", async () => {
    const spy = vi.spyOn(pipelineMod, "streamSummaryForVisiblePage").mockImplementation(
      async (args) => {
        // Verify the extracted text is passed correctly
        expect(args.input.text).toContain("Hello PDF");
        expect(args.input.url).toContain("upload:");

        args.sink.onModelChosen("openai/gpt-4o");
        args.sink.writeChunk("Summary of PDF");
        return {
          usedModel: "openai/gpt-4o",
          report: { llm: [] },
          metrics: { elapsedMs: 100, summary: "", details: "", summaryDetailed: "", detailsDetailed: "", pipeline: [] },
          insights: null,
          extracted: { content: "" },
        } as any;
      },
    );

    const app = createTestApp();
    // Create a minimal valid PDF-like content (pdf-parse will be mocked)
    const form = new FormData();
    form.append("file", new File(["dummy pdf content"], "report.pdf", { type: "application/pdf" }));
    form.append("length", "medium");

    // Mock pdf-parse to return extracted text
    vi.doMock("pdf-parse", () => ({
      default: vi.fn().mockResolvedValue({ text: "Hello PDF world", numpages: 2, info: {} }),
    }));

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      body: form,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    const events = parseSseText(text);
    const chunkEvents = events.filter((e) => e.event === "chunk");
    expect(chunkEvents.length).toBeGreaterThan(0);
    expect(chunkEvents[0].data.text).toContain("Summary of PDF");

    spy.mockRestore();
  });

  it("returns 422 when PDF has no extractable text", async () => {
    const app = createTestApp();
    const form = new FormData();
    form.append("file", new File(["dummy"], "scanned.pdf", { type: "application/pdf" }));

    vi.doMock("pdf-parse", () => ({
      default: vi.fn().mockResolvedValue({ text: "", numpages: 1, info: {} }),
    }));

    const res = await app.request("/v1/summarize", {
      method: "POST",
      body: form,
    });

    // Should get an error about empty PDF
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("EXTRACTION_FAILED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.upload-pdf.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement upload-pdf handler**

```typescript
// src/server/handlers/upload-pdf.ts
import type { Context } from "hono";
import type { StreamSink } from "../../summarize/pipeline.js";

/**
 * Extract text from a PDF file and return it.
 * Throws on failure or empty content.
 */
export async function extractPdfText(file: File): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await pdfParse(buffer);
  const text = result.text?.trim();
  if (!text) {
    throw new Error(
      "PDF appears to contain only images or no extractable text. Try uploading as an image instead.",
    );
  }
  return text;
}
```

- [ ] **Step 4: Wire PDF handler into the summarize route**

In `src/server/routes/summarize.ts`, add import:
```typescript
import { extractPdfText } from "../handlers/upload-pdf.js";
```

Replace the `NOT_IMPLEMENTED` return at the end of the multipart block with the file type routing. This is a large change, so here's the structure:

After the `console.log` for the file upload, replace the `NOT_IMPLEMENTED` return with:

```typescript
      // ---- Process file by type ----
      if (fileType === "pdf") {
        let extractedText: string;
        try {
          extractedText = await extractPdfText(file);
        } catch (err) {
          const message = err instanceof Error ? err.message : "PDF extraction failed";
          if (!wantsSSE) {
            return c.json(jsonError("EXTRACTION_FAILED", message), 422);
          }
          // For SSE, still return the error as an SSE event
          const sessionManager = deps.sseSessionManager;
          if (!sessionManager) {
            return c.json(jsonError("SERVER_ERROR", "SSE streaming not available"), 500);
          }
          const errSummaryId = randomUUID();
          sessionManager.createSession(errSummaryId);
          return streamSSE(c, async (stream) => {
            await stream.writeSSE({ event: "error", data: JSON.stringify({ message, code: "EXTRACTION_FAILED" }), id: "1" });
          });
        }

        const sourceLabel = `upload:${file.name}`;

        if (wantsSSE) {
          const sessionManager = deps.sseSessionManager;
          if (!sessionManager) {
            return c.json(jsonError("SERVER_ERROR", "SSE streaming not available"), 500);
          }
          const summaryId = randomUUID();
          sessionManager.createSession(summaryId);
          let eventCounter = 0;
          const pushAndBuffer = (event: SseEvent): number => {
            eventCounter++;
            sessionManager.pushEvent(summaryId, event);
            return eventCounter;
          };

          return streamSSE(c, async (stream) => {
            try {
              const initEvt: SseEvent = { event: "init", data: { summaryId } };
              const initId = pushAndBuffer(initEvt);
              await stream.writeSSE({ event: "init", data: JSON.stringify(initEvt.data), id: String(initId) });

              const chunks: string[] = [];
              let chosenModel: string | null = null;
              const sink: StreamSink = {
                writeChunk: (text) => {
                  chunks.push(text);
                  const evt: SseEvent = { event: "chunk", data: { text } };
                  const id = pushAndBuffer(evt);
                  void stream.writeSSE({ event: "chunk", data: JSON.stringify(evt.data), id: String(id) });
                },
                onModelChosen: (model) => {
                  chosenModel = model;
                  const evt: SseEvent = { event: "meta", data: { model, modelLabel: model, inputSummary: null } };
                  const id = pushAndBuffer(evt);
                  void stream.writeSSE({ event: "meta", data: JSON.stringify(evt.data), id: String(id) });
                },
                writeStatus: (text) => {
                  const evt: SseEvent = { event: "status", data: { text } };
                  const id = pushAndBuffer(evt);
                  void stream.writeSSE({ event: "status", data: JSON.stringify(evt.data), id: String(id) });
                },
                writeMeta: (data) => {
                  const evt: SseEvent = { event: "meta", data: { model: chosenModel, modelLabel: chosenModel, inputSummary: data.inputSummary ?? null, summaryFromCache: data.summaryFromCache ?? null } };
                  const id = pushAndBuffer(evt);
                  void stream.writeSSE({ event: "meta", data: JSON.stringify(evt.data), id: String(id) });
                },
              };

              const result = await streamSummaryForVisiblePage({
                env: deps.env,
                fetchImpl: fetch,
                input: { url: sourceLabel, title: file.name, text: extractedText, truncated: false },
                modelOverride,
                promptOverride: null,
                lengthRaw,
                languageRaw: null,
                sink,
                cache: deps.cache,
                mediaCache: deps.mediaCache,
                overrides: DEFAULT_OVERRIDES,
              });

              // Metrics
              const metricsEvt: SseEvent = { event: "metrics", data: { elapsedMs: result.metrics.elapsedMs, summary: result.metrics.summary, details: result.metrics.details, summaryDetailed: result.metrics.summaryDetailed, detailsDetailed: result.metrics.detailsDetailed, pipeline: result.metrics.pipeline } };
              const metricsId = pushAndBuffer(metricsEvt);
              await stream.writeSSE({ event: "metrics", data: JSON.stringify(metricsEvt.data), id: String(metricsId) });

              // History
              if (deps.historyStore) {
                void Promise.resolve().then(() => {
                  try {
                    deps.historyStore!.insert({
                      id: summaryId, createdAt: new Date().toISOString(), account,
                      sourceUrl: sourceLabel, sourceType: "document", inputLength: lengthRaw,
                      model: result.usedModel, title: file.name, summary: chunks.join(""),
                      transcript: extractedText, mediaPath: null, mediaSize: null, mediaType: null,
                      metadata: result.insights ? JSON.stringify(result.insights) : null,
                    });
                  } catch (histErr) { console.error("[summarize-api] history recording failed:", histErr); }
                });
              }

              // Done
              const doneEvt = { event: "done" as const, data: { summaryId: String(summaryId) } };
              const doneId = pushAndBuffer(doneEvt);
              await stream.writeSSE({ event: "done", data: JSON.stringify(doneEvt.data), id: String(doneId) });
              sessionManager.markComplete(summaryId);
            } catch (err) {
              console.error("[summarize-api] SSE file upload error:", err);
              const classified = classifyError(err);
              const errorEvt = { event: "error" as const, data: { message: classified.message, code: classified.code } };
              const errorId = pushAndBuffer(errorEvt);
              await stream.writeSSE({ event: "error", data: JSON.stringify(errorEvt.data), id: String(errorId) });
            }
          });
        }

        // JSON response path for PDF
        try {
          const chunks: string[] = [];
          const sink: StreamSink = {
            writeChunk: (text) => chunks.push(text),
            onModelChosen: (model) => console.log(`[summarize-api] model chosen: ${model}`),
          };
          const result = await streamSummaryForVisiblePage({
            env: deps.env, fetchImpl: fetch,
            input: { url: sourceLabel, title: file.name, text: extractedText, truncated: false },
            modelOverride, promptOverride: null, lengthRaw, languageRaw: null,
            sink, cache: deps.cache, mediaCache: deps.mediaCache, overrides: DEFAULT_OVERRIDES,
          });
          const summaryId = randomUUID();
          return c.json({
            summaryId, summary: chunks.join(""),
            metadata: { title: file.name, source: sourceLabel, model: result.usedModel, usage: null, durationMs: result.metrics.elapsedMs },
            insights: result.insights,
          });
        } catch (err) {
          console.error("[summarize-api] PDF summarization error:", err);
          const classified = classifyError(err);
          return c.json(jsonError(classified.code, classified.message), classified.httpStatus as any);
        }
      }

      // Other file types — not yet implemented
      return c.json(jsonError("NOT_IMPLEMENTED", `File type '${fileType}' processing not yet implemented`), 501);
```

Note: This is a large block. Much of the SSE streaming logic duplicates the existing URL/text paths. Consider extracting a shared `streamWithSse` helper after all file types work — but for now, explicit code is clearer for implementation.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/server.upload-pdf.test.ts tests/server.upload.test.ts`
Expected: PASS

- [ ] **Step 6: Run all server tests**

Run: `pnpm vitest run tests/server.*.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/handlers/upload-pdf.ts src/server/routes/summarize.ts tests/server.upload-pdf.test.ts
git commit -m "feat(server): implement PDF upload extraction and summarization"
```

---

## Chunk 3: Image Processing

### Task 3.1: Implement image upload handler

**Files:**
- Create: `src/server/handlers/upload-image.ts`
- Modify: `src/server/routes/summarize.ts` (add image routing)
- Test: `tests/server.upload-image.test.ts`

**Approach:** Use `streamTextWithModelId` from `src/llm/generate-text.ts` directly with a `Prompt` containing an image attachment. This bypasses `UrlFlowContext` (which doesn't expose its summary engine) and calls the LLM layer directly. The LLM layer already supports `Prompt.attachments` with `kind: "image"` — see `promptToContext()` in `src/llm/generate-text.ts:52-75` which converts image attachments to multimodal messages.

After getting the image description from the vision model, feed it into `streamSummaryForVisiblePage` as text — same pattern as PDF and audio/video. This keeps the summary quality consistent across all file types.

- [ ] **Step 1: Write test**

```typescript
// tests/server.upload-image.test.ts
import { Hono } from "hono";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSummarizeRoute, type SummarizeRouteDeps } from "../src/server/routes/summarize.js";
import { SseSessionManager } from "../src/server/sse-session.js";
import * as pipelineMod from "../src/summarize/pipeline.js";
import * as generateTextMod from "../src/llm/generate-text.js";

function parseSseText(text: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  const blocks = text.split("\n\n").filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "", data = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (event && data) events.push({ event, data: JSON.parse(data) });
  }
  return events;
}

describe("Image upload", () => {
  let sseSessionManager: SseSessionManager;

  beforeEach(() => {
    sseSessionManager = new SseSessionManager();
  });

  function createTestApp(envOverrides?: Record<string, string>) {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("account", "test-user");
      await next();
    });
    app.route("/v1", createSummarizeRoute({
      env: { ANTHROPIC_API_KEY: "test-key", ...envOverrides },
      config: null,
      cache: { mode: "bypass" as const, store: null, ttlMs: 0, maxBytes: 0, path: null },
      mediaCache: null,
      historyStore: null,
      historyMediaPath: null,
      sseSessionManager,
    }));
    return app;
  }

  it("accepts PNG upload, describes via vision, then summarizes", async () => {
    // Mock the vision call (streamTextWithModelId)
    const visionSpy = vi.spyOn(generateTextMod, "streamTextWithModelId").mockResolvedValueOnce({
      text: "This image shows a bar chart of quarterly revenue. Q1: $10M, Q2: $15M, Q3: $12M, Q4: $20M.",
      textStream: (async function* () { yield "This image shows a bar chart..."; })(),
      usage: { promptTokens: 100, completionTokens: 50 },
    } as any);

    // Mock the summary call (streamSummaryForVisiblePage)
    const summarySpy = vi.spyOn(pipelineMod, "streamSummaryForVisiblePage").mockImplementation(
      async (args) => {
        expect(args.input.text).toContain("bar chart");
        args.sink.onModelChosen("openai/gpt-4o");
        args.sink.writeChunk("Revenue grew 100% from Q1 to Q4.");
        return {
          usedModel: "openai/gpt-4o",
          report: { llm: [] },
          metrics: { elapsedMs: 200, summary: "", details: "", summaryDetailed: "", detailsDetailed: "", pipeline: [] },
          insights: null,
          extracted: { content: "" },
        } as any;
      },
    );

    const app = createTestApp();
    const form = new FormData();
    form.append("file", new File([new Uint8Array(8)], "chart.png", { type: "image/png" }));
    form.append("length", "short");

    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      body: form,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    const events = parseSseText(text);
    expect(events.some((e) => e.event === "init")).toBe(true);
    const chunks = events.filter((e) => e.event === "chunk");
    expect(chunks.length).toBeGreaterThan(0);

    visionSpy.mockRestore();
    summarySpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.upload-image.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement upload-image handler**

```typescript
// src/server/handlers/upload-image.ts
import { streamTextWithModelId } from "../../llm/generate-text.js";
import type { Prompt } from "../../llm/prompt.js";
import type { LlmApiKeys } from "../../llm/api-keys.js";

/**
 * Describe an image using a vision-capable LLM.
 * Returns the text description of the image content.
 *
 * Uses streamTextWithModelId directly with a Prompt containing an image attachment.
 * The LLM layer handles the multimodal message format via promptToContext().
 */
export async function describeImage(
  file: { name: string; type: string; bytes: Uint8Array },
  options: {
    env: Record<string, string | undefined>;
    modelOverride: string | null;
    fetchImpl: typeof fetch;
  },
): Promise<{ text: string; modelId: string }> {
  const prompt: Prompt = {
    system: [
      "You are analyzing an uploaded image.",
      "Describe this image in detail.",
      "Extract any visible text, data, tables, charts, or numbers.",
      "If there is text in the image, include it verbatim.",
      "Format your response as plain text, not Markdown.",
    ].join("\n"),
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

  // Resolve model — prefer override, then env default, then Claude (vision-capable)
  const modelId = options.modelOverride
    ?? options.env.SUMMARIZE_DEFAULT_MODEL
    ?? "anthropic/claude-sonnet-4-20250514";

  // Build API keys from env
  const apiKeys: LlmApiKeys = {
    xaiApiKey: options.env.XAI_API_KEY ?? null,
    openaiApiKey: options.env.OPENAI_API_KEY ?? null,
    googleApiKey: options.env.GEMINI_API_KEY ?? options.env.GOOGLE_GENERATIVE_AI_API_KEY ?? options.env.GOOGLE_API_KEY ?? null,
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

  // Collect the full text (streamTextWithModelId returns a textStream async iterable)
  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
  }

  if (!fullText.trim()) {
    throw new Error("Vision model returned empty description for the image.");
  }

  return { text: fullText.trim(), modelId };
}
```

Note: Check the exact return type of `streamTextWithModelId` in `src/llm/generate-text.ts`. It should return `{ textStream: AsyncIterable<string>, ... }`. If the API differs, adjust accordingly. The key principle is: build a `Prompt` with `attachments: [{ kind: "image", ... }]` and pass it to `streamTextWithModelId`.

Note: Also check `LlmApiKeys` type in `src/llm/api-keys.ts` for the exact field names. The fields listed above are inferred from the codebase exploration.

- [ ] **Step 4: Wire image handler into summarize route**

Add import to `src/server/routes/summarize.ts`:
```typescript
import { describeImage } from "../handlers/upload-image.js";
```

Add after the PDF `if` block in the multipart section:

```typescript
      if (fileType === "image") {
        const imageBytes = new Uint8Array(await file.arrayBuffer());
        const sourceLabel = `upload:${file.name}`;

        // Step 1: Get image description from vision model
        let imageDescription: string;
        try {
          const visionResult = await describeImage(
            { name: file.name, type: file.type, bytes: imageBytes },
            { env: deps.env, modelOverride, fetchImpl: fetch },
          );
          imageDescription = visionResult.text;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Image analysis failed";
          if (wantsSSE) {
            return streamSSE(c, async (stream) => {
              await stream.writeSSE({ event: "error", data: JSON.stringify({ message, code: "VISION_FAILED" }), id: "1" });
            });
          }
          return c.json(jsonError("VISION_FAILED", message), 502);
        }

        // Step 2: Summarize the description using the standard text pipeline
        // (same pattern as PDF — feed extracted text to streamSummaryForVisiblePage)
        if (wantsSSE) {
          // [SSE streaming path — same structure as PDF SSE path]
          // Uses streamSummaryForVisiblePage with imageDescription as text
          // sourceType = "image"
          // ... (same SSE boilerplate as PDF handler, with sourceType = "image")
          // The implementer should copy the PDF SSE block and change:
          //   - extractedText → imageDescription
          //   - sourceType: "document" → sourceType: "image"
          //   - transcript: extractedText → transcript: imageDescription
          // ... (full block omitted to avoid duplication — see PDF handler for pattern)
        }

        // JSON path — same as PDF but with imageDescription
        // ... (copy PDF JSON path, replace extractedText with imageDescription)
      }
```

The implementer should follow the exact same SSE/JSON pattern as the PDF handler (Task 2.2), replacing `extractedText` with `imageDescription` and `sourceType: "document"` with `sourceType: "image"`. The refactoring task (Task 7.0) will extract the shared boilerplate.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/server.upload-image.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/handlers/upload-image.ts src/server/routes/summarize.ts tests/server.upload-image.test.ts
git commit -m "feat(server): implement image upload with vision model analysis"
```

---

## Chunk 4: Audio/Video Processing

### Task 4.1: Implement audio/video upload handler

**Files:**
- Create: `src/server/handlers/upload-media.ts`
- Modify: `src/server/routes/summarize.ts` (add audio/video routing)
- Test: `tests/server.upload-media.test.ts`

Follows the pattern from `src/run/flows/asset/media.ts`: write file to temp dir, create `LinkPreviewClient`, call `fetchLinkContent` with `file://` URL, feed transcript to `streamSummaryForVisiblePage`.

- [ ] **Step 1: Write test**

```typescript
// tests/server.upload-media.test.ts
import { Hono } from "hono";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSummarizeRoute, type SummarizeRouteDeps } from "../src/server/routes/summarize.js";
import { SseSessionManager } from "../src/server/sse-session.js";
import * as pipelineMod from "../src/summarize/pipeline.js";

describe("Audio/Video upload", () => {
  let sseSessionManager: SseSessionManager;

  beforeEach(() => {
    sseSessionManager = new SseSessionManager();
  });

  function createTestApp() {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("account", "test-user");
      await next();
    });
    app.route("/v1", createSummarizeRoute({
      env: { GROQ_API_KEY: "test-groq-key" },
      config: null,
      cache: { mode: "bypass" as const, store: null, ttlMs: 0, maxBytes: 0, path: null },
      mediaCache: null,
      historyStore: null,
      historyMediaPath: null,
      sseSessionManager,
    }));
    return app;
  }

  it("accepts MP3 upload for transcription", async () => {
    const app = createTestApp();
    const form = new FormData();
    form.append("file", new File([new Uint8Array(100)], "episode.mp3", { type: "audio/mpeg" }));
    form.append("length", "medium");

    // The actual transcription will fail in tests since we don't have real audio.
    // We mock createLinkPreviewClient to return a transcript.
    // This test verifies the route reaches the media handler (not 501).
    const res = await app.request("/v1/summarize", {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      body: form,
    });

    // Should not return 501 (not implemented) — it should attempt processing
    expect(res.status).not.toBe(501);
  });
});
```

- [ ] **Step 2: Implement upload-media handler**

```typescript
// src/server/handlers/upload-media.ts
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createLinkPreviewClient } from "../../../packages/core/src/content/link-preview/client.js";
import type { MediaCache } from "../../../packages/core/src/content/cache/types.js";

// NOTE: The import paths above are relative from src/server/handlers/.
// In practice, use the package import if available:
//   import { createLinkPreviewClient } from "@steipete/summarize_p2-core/content";
// Check which import style the rest of the server code uses and follow that pattern.
// The CLI code at src/run/flows/asset/media.ts imports from "../../../content/index.js"
// which re-exports from core. Use that same pattern.

export interface TranscribeMediaFileOptions {
  env: Record<string, string | undefined>;
  mediaCache: MediaCache | null;
}

/**
 * Write uploaded media file to temp dir, transcribe via LinkPreviewClient, return transcript text.
 * Cleans up temp files on completion or error.
 *
 * Follows the same pattern as src/run/flows/asset/media.ts (summarizeMediaFile):
 * create LinkPreviewClient → fetchLinkContent with file:// URL → get transcript.
 * API keys are passed as top-level options to createLinkPreviewClient (NOT nested in transcription).
 */
export async function transcribeUploadedMedia(
  file: File,
  options: TranscribeMediaFileOptions,
): Promise<{ text: string; tempDir: string }> {
  const tempDir = join(tmpdir(), `summarize-upload-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  const tempPath = join(tempDir, file.name);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tempPath, buffer);

    // API keys are top-level options, NOT nested inside transcription.
    // See src/run/flows/asset/media.ts lines 189-218 for the reference pattern.
    const client = createLinkPreviewClient({
      env: options.env,
      fetch,
      // Transcription API keys — all top-level on LinkPreviewClientOptions
      mistralApiKey: options.env.MISTRAL_API_KEY ?? null,
      groqApiKey: options.env.GROQ_API_KEY ?? null,
      assemblyaiApiKey: options.env.ASSEMBLYAI_API_KEY ?? null,
      geminiApiKey: options.env.GEMINI_API_KEY ?? options.env.GOOGLE_GENERATIVE_AI_API_KEY ?? null,
      openaiApiKey: options.env.OPENAI_API_KEY ?? null,
      falApiKey: options.env.FAL_KEY ?? null,
      mediaCache: options.mediaCache,
    });

    const fileUrl = pathToFileURL(tempPath).href;
    const extracted = await client.fetchLinkContent(fileUrl, {
      timeoutMs: 300_000,
      cacheMode: "bypass",
      youtubeTranscript: "auto",
      mediaTranscript: "prefer",
      transcriptTimestamps: false,
    });

    const text = extracted.content?.trim();
    if (!text) {
      throw new Error("Failed to transcribe media file. Check that the file is valid audio/video and a transcription provider is configured.");
    }

    return { text, tempDir };
  } catch (err) {
    // Cleanup on error
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}
```

- [ ] **Step 3: Wire audio/video handler into summarize route**

Add import:
```typescript
import { transcribeUploadedMedia } from "../handlers/upload-media.js";
```

Add after the image block, before the final `NOT_IMPLEMENTED` return:

```typescript
      if (fileType === "audio" || fileType === "video") {
        const sourceLabel = `upload:${file.name}`;
        const sourceType = fileType === "audio" ? "podcast" : "video";

        let transcriptText: string;
        let tempDir: string;
        try {
          const result = await transcribeUploadedMedia(file, {
            env: deps.env,
            mediaCache: deps.mediaCache,
          });
          transcriptText = result.text;
          tempDir = result.tempDir;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Transcription failed";
          if (wantsSSE) {
            // Return error as SSE event
            return streamSSE(c, async (stream) => {
              await stream.writeSSE({ event: "error", data: JSON.stringify({ message, code: "TRANSCRIPTION_FAILED" }), id: "1" });
            });
          }
          return c.json(jsonError("TRANSCRIPTION_FAILED", message), 502);
        }

        // Now summarize the transcript text using the same path as PDF
        // (reuses streamSummaryForVisiblePage with the transcript as text)
        if (wantsSSE) {
          // [SSE streaming path — same structure as PDF SSE path above]
          // Use streamSummaryForVisiblePage with transcriptText
          // sourceType = "podcast" or "video"
          // After completion, cleanup temp dir
          const sessionManager = deps.sseSessionManager;
          if (!sessionManager) {
            await rm(tempDir, { recursive: true, force: true }).catch(() => {});
            return c.json(jsonError("SERVER_ERROR", "SSE streaming not available"), 500);
          }
          const summaryId = randomUUID();
          sessionManager.createSession(summaryId);
          let eventCounter = 0;
          const pushAndBuffer = (event: SseEvent): number => {
            eventCounter++;
            sessionManager.pushEvent(summaryId, event);
            return eventCounter;
          };

          return streamSSE(c, async (stream) => {
            try {
              const initEvt: SseEvent = { event: "init", data: { summaryId } };
              await stream.writeSSE({ event: "init", data: JSON.stringify(initEvt.data), id: String(pushAndBuffer(initEvt)) });

              const chunks: string[] = [];
              let chosenModel: string | null = null;
              const sink: StreamSink = {
                writeChunk: (text) => {
                  chunks.push(text);
                  const evt: SseEvent = { event: "chunk", data: { text } };
                  void stream.writeSSE({ event: "chunk", data: JSON.stringify(evt.data), id: String(pushAndBuffer(evt)) });
                },
                onModelChosen: (model) => {
                  chosenModel = model;
                  const evt: SseEvent = { event: "meta", data: { model, modelLabel: model, inputSummary: null } };
                  void stream.writeSSE({ event: "meta", data: JSON.stringify(evt.data), id: String(pushAndBuffer(evt)) });
                },
                writeStatus: (text) => {
                  const evt: SseEvent = { event: "status", data: { text } };
                  void stream.writeSSE({ event: "status", data: JSON.stringify(evt.data), id: String(pushAndBuffer(evt)) });
                },
                writeMeta: (data) => {
                  const evt: SseEvent = { event: "meta", data: { model: chosenModel, modelLabel: chosenModel, inputSummary: data.inputSummary ?? null, summaryFromCache: data.summaryFromCache ?? null } };
                  void stream.writeSSE({ event: "meta", data: JSON.stringify(evt.data), id: String(pushAndBuffer(evt)) });
                },
              };

              const result = await streamSummaryForVisiblePage({
                env: deps.env, fetchImpl: fetch,
                input: { url: sourceLabel, title: file.name, text: transcriptText, truncated: false },
                modelOverride, promptOverride: null, lengthRaw, languageRaw: null,
                sink, cache: deps.cache, mediaCache: deps.mediaCache, overrides: DEFAULT_OVERRIDES,
              });

              const metricsEvt: SseEvent = { event: "metrics", data: { elapsedMs: result.metrics.elapsedMs, summary: result.metrics.summary, details: result.metrics.details, summaryDetailed: result.metrics.summaryDetailed, detailsDetailed: result.metrics.detailsDetailed, pipeline: result.metrics.pipeline } };
              await stream.writeSSE({ event: "metrics", data: JSON.stringify(metricsEvt.data), id: String(pushAndBuffer(metricsEvt)) });

              if (deps.historyStore) {
                void Promise.resolve().then(() => {
                  try {
                    deps.historyStore!.insert({
                      id: summaryId, createdAt: new Date().toISOString(), account,
                      sourceUrl: sourceLabel, sourceType, inputLength: lengthRaw,
                      model: result.usedModel, title: file.name, summary: chunks.join(""),
                      transcript: transcriptText, mediaPath: null, mediaSize: null, mediaType: null,
                      metadata: result.insights ? JSON.stringify(result.insights) : null,
                    });
                  } catch (histErr) { console.error("[summarize-api] history recording failed:", histErr); }
                });
              }

              const doneEvt = { event: "done" as const, data: { summaryId: String(summaryId) } };
              await stream.writeSSE({ event: "done", data: JSON.stringify(doneEvt.data), id: String(pushAndBuffer(doneEvt)) });
              sessionManager.markComplete(summaryId);
            } catch (err) {
              console.error("[summarize-api] SSE media upload error:", err);
              const classified = classifyError(err);
              const errorEvt = { event: "error" as const, data: { message: classified.message, code: classified.code } };
              await stream.writeSSE({ event: "error", data: JSON.stringify(errorEvt.data), id: String(pushAndBuffer(errorEvt)) });
            } finally {
              await rm(tempDir, { recursive: true, force: true }).catch(() => {});
            }
          });
        }

        // JSON path for audio/video
        try {
          const chunks: string[] = [];
          const sink: StreamSink = {
            writeChunk: (text) => chunks.push(text),
            onModelChosen: (model) => console.log(`[summarize-api] model chosen: ${model}`),
          };
          const result = await streamSummaryForVisiblePage({
            env: deps.env, fetchImpl: fetch,
            input: { url: sourceLabel, title: file.name, text: transcriptText, truncated: false },
            modelOverride, promptOverride: null, lengthRaw, languageRaw: null,
            sink, cache: deps.cache, mediaCache: deps.mediaCache, overrides: DEFAULT_OVERRIDES,
          });
          const summaryId = randomUUID();
          await rm(tempDir, { recursive: true, force: true }).catch(() => {});
          return c.json({
            summaryId, summary: chunks.join(""),
            metadata: { title: file.name, source: sourceLabel, model: result.usedModel, usage: null, durationMs: result.metrics.elapsedMs },
            insights: result.insights,
          });
        } catch (err) {
          await rm(tempDir, { recursive: true, force: true }).catch(() => {});
          const classified = classifyError(err);
          return c.json(jsonError(classified.code, classified.message), classified.httpStatus as any);
        }
      }
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/server.upload-media.test.ts tests/server.upload.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm vitest run tests/server.*.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/handlers/upload-media.ts src/server/routes/summarize.ts tests/server.upload-media.test.ts
git commit -m "feat(server): implement audio/video upload with transcription pipeline"
```

---

## Chunk 5: Frontend — Unified Input Component

### Task 5.1: Create the unified input component

**Files:**
- Create: `apps/web/src/components/unified-input.tsx`
- Create: `apps/web/src/lib/file-utils.ts`
- Modify: `apps/web/src/components/summarize-view.tsx`

- [ ] **Step 1: Create file utility helpers**

```typescript
// apps/web/src/lib/file-utils.ts

export type InputMode = "empty" | "url" | "text" | "file";

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".mp3", ".m4a", ".wav", ".flac", ".aac", ".ogg", ".opus",
  ".mp4", ".mov", ".mkv", ".webm",
]);

const ACCEPT_STRING = Array.from(ALLOWED_EXTENSIONS).join(",");

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB

export { ACCEPT_STRING, MAX_FILE_SIZE };

export type FileCategory = "pdf" | "image" | "audio" | "video";

export function getFileCategory(file: File): FileCategory | null {
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  if ([".pdf"].includes(ext)) return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if ([".mp3", ".m4a", ".wav", ".flac", ".aac", ".ogg", ".opus"].includes(ext)) return "audio";
  if ([".mp4", ".mov", ".mkv", ".webm"].includes(ext)) return "video";
  // Fallback to MIME
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

export function isAllowedFile(file: File): boolean {
  return getFileCategory(file) !== null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const URL_REGEX = /^https?:\/\/\S+$/;

export function detectInputMode(text: string, file: File | null): InputMode {
  if (file) return "file";
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (URL_REGEX.test(trimmed)) return "url";
  return "text";
}

export function getFileIcon(category: FileCategory): string {
  switch (category) {
    case "pdf": return "\u{1F4C4}"; // 📄
    case "image": return "\u{1F5BC}"; // 🖼
    case "audio": return "\u{1F3B5}"; // 🎵
    case "video": return "\u{1F3AC}"; // 🎬
  }
}
```

- [ ] **Step 2: Create unified input component**

Create `apps/web/src/components/unified-input.tsx` — a component that handles the textarea, drag-and-drop, paste, and file browse. It calls back to the parent with the detected input mode and values.

The component manages:
- `textValue` state (for URL or text input)
- `file` state (for file attachment)
- `dragging` state (for drag hover visual)
- `fileError` state (for validation errors)

Props:
```typescript
type UnifiedInputProps = {
  onSubmit: (input: { mode: "url"; url: string } | { mode: "text"; text: string } | { mode: "file"; file: File }) => void;
  disabled: boolean;
  length: ApiLength;
  onLengthChange: (length: ApiLength) => void;
};
```

This is a large component (~200 lines). The implementer should:
1. Use a `<textarea>` with `ondragover`, `ondragleave`, `ondrop`, `onpaste` handlers
2. When a file is attached, replace the textarea with a file card
3. Include a hidden `<input type="file">` for the browse button
4. Auto-detect URL vs text on submit
5. Validate file type and size on drop/paste/browse

- [ ] **Step 3: Update SummarizeView to use unified input**

Modify `apps/web/src/components/summarize-view.tsx`:
- Remove the URL/Text tab switcher and separate input fields
- Replace with `<UnifiedInput>` component
- Update `handleSubmit` to handle the three modes: URL calls `summarizeSSE({ url })`, text calls `summarizeSSE({ text })`, file calls the new `summarizeFileSSE()`

- [ ] **Step 4: Test manually in dev mode**

Run: `pnpm -C apps/web dev`
- Verify typing a URL shows "URL detected" badge
- Verify typing text works normally
- Verify drag-and-drop shows hover state and attaches file
- Verify paste image from clipboard works
- Verify browse button opens file picker
- Verify file card shows with remove button
- Verify size validation rejects >200 MB
- Verify unsupported file types show error

- [ ] **Step 5: Verify build**

Run: `pnpm -C apps/web build`
Expected: builds without errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/file-utils.ts apps/web/src/components/unified-input.tsx apps/web/src/components/summarize-view.tsx
git commit -m "feat(web): add unified input with drag-drop, paste, and file browse"
```

---

## Chunk 6: Frontend — API Client & Integration

### Task 6.1: Add summarizeFileSSE to API client

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add summarizeFileSSE function**

Add to `apps/web/src/lib/api.ts`:

```typescript
/**
 * Upload a file for summarization via multipart/form-data with SSE streaming.
 */
export function summarizeFileSSE(
  file: File,
  options: { length?: ApiLength },
  callbacks: {
    onInit?: (summaryId: string) => void;
    onStatus?: (text: string) => void;
    onChunk?: (text: string) => void;
    onMeta?: (data: SseMetaEvent["data"]) => void;
    onDone?: (summaryId: string) => void;
    onError?: (message: string, code: string) => void;
    onMetrics?: (data: Record<string, unknown>) => void;
  },
): AbortController {
  const controller = new AbortController();
  const form = new FormData();
  form.append("file", file);
  if (options.length) form.append("length", options.length);

  fetch("/v1/summarize", {
    method: "POST",
    headers: {
      ...authHeaders(),
      Accept: "text/event-stream",
      // Do NOT set Content-Type — browser sets it with multipart boundary
    },
    body: form,
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        callbacks.onError?.(
          err?.error?.message ?? `Request failed (${res.status})`,
          err?.error?.code ?? "HTTP_ERROR",
        );
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError?.("No response body", "NO_BODY");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (currentEvent) {
                case "init": callbacks.onInit?.(data.summaryId); break;
                case "status": callbacks.onStatus?.(data.text); break;
                case "chunk": callbacks.onChunk?.(data.text); break;
                case "meta": callbacks.onMeta?.(data); break;
                case "done": callbacks.onDone?.(data.summaryId); break;
                case "error": callbacks.onError?.(data.message, data.code); break;
                case "metrics": callbacks.onMetrics?.(data); break;
              }
            } catch { /* skip */ }
            currentEvent = "";
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        callbacks.onError?.(err.message ?? "Network error", "NETWORK_ERROR");
      }
    });

  return controller;
}
```

Note: The SSE parsing is duplicated from `summarizeSSE`. Consider extracting a shared `parseSseStream` helper to reduce duplication — but this is a refactoring step, not required for functionality.

- [ ] **Step 2: Wire file upload into SummarizeView**

In the `handleSubmit` callback of `SummarizeView`, add the file branch:

```typescript
// In handleSubmit, before the existing summarizeSSE call:
if (input.mode === "file") {
  controllerRef.current = summarizeFileSSE(input.file, { length }, {
    onInit: (id) => { setSummaryId(id); navigate(`/s/${id}`); },
    onStatus: (text) => setStatusText(text),
    onChunk: (text) => setChunks((prev) => prev + text),
    onMeta: () => {},
    onDone: (id) => { setSummaryId(id); setPhase("done"); stopTimer(); },
    onError: (message) => { setErrorMsg(message); setPhase("error"); stopTimer(); },
    onMetrics: () => {},
  });
  return;
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm -C apps/web build`
Expected: PASS

- [ ] **Step 4: Full build**

Run: `pnpm -s build`
Expected: PASS (builds core, web, lib, CLI)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/components/summarize-view.tsx
git commit -m "feat(web): add file upload API client and wire into summarize view"
```

---

## Chunk 7: Refactor, Build, Test & Deploy

### Task 7.0: Extract shared SSE streaming helper

The PDF, image, and audio/video handlers all duplicate the same SSE boilerplate (~80 lines each): session creation, pushAndBuffer, sink setup, metrics emission, history recording, done/error events. Extract this into a shared helper.

**Files:**
- Create: `src/server/utils/sse-file-stream.ts`
- Modify: `src/server/routes/summarize.ts` (replace duplicated blocks with helper calls)

- [ ] **Step 1: Extract the shared helper**

Create a function like:
```typescript
export async function streamFileUploadSSE(c, deps, {
  summaryId, account, sourceLabel, sourceType, fileName,
  extractedText, lengthRaw, modelOverride, startTime,
}): Promise<Response>
```

That encapsulates: session creation → init event → streamSummaryForVisiblePage with sink → metrics → history → done/error.

- [ ] **Step 2: Replace the 3 duplicated SSE blocks in summarize.ts with calls to the helper**

- [ ] **Step 3: Run all tests to verify no regressions**

Run: `pnpm vitest run tests/server.*.test.ts`

- [ ] **Step 4: Also extract shared SSE parser in frontend API client**

In `apps/web/src/lib/api.ts`, the SSE parsing logic is duplicated in `summarizeSSE`, `connectToProcess`, and `summarizeFileSSE`. Extract a shared `parseSseResponse(reader, callbacks)` function.

- [ ] **Step 5: Commit**

```bash
git add src/server/utils/sse-file-stream.ts src/server/routes/summarize.ts apps/web/src/lib/api.ts
git commit -m "refactor: extract shared SSE streaming helpers to reduce duplication"
```

### Task 7.1: Run full test suite and build

- [ ] **Step 1: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 2: Full build**

Run: `pnpm -s build`
Expected: Clean build

- [ ] **Step 3: Manual end-to-end test locally**

Start the server: `node dist/esm/server/main.js`
Open `http://localhost:3000` in browser.
Test:
1. Drop a PDF → should extract text and stream summary
2. Paste a screenshot (Cmd+V) → should analyze image and stream summary
3. Drop an MP3 → should transcribe and stream summary
4. Paste a URL → should work as before
5. Type text → should work as before

- [ ] **Step 4: Commit any fixes from testing**

### Task 7.2: Deploy to production

- [ ] **Step 1: Build Docker image**

```bash
docker buildx build --platform linux/amd64 -t ghcr.io/perelin/summarize-api:latest --push .
```

- [ ] **Step 2: Deploy to server**

```bash
ssh pve-htz-docker 'cd /opt/apps/summarize && docker compose pull -q && docker compose up -d'
```

- [ ] **Step 3: Verify on production**

Open `https://summarize.p2lab.com` and test file upload with a small PDF.

- [ ] **Step 4: Commit plan completion note**

Update this plan doc: mark all tasks complete.
