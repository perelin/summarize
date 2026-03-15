import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import * as uploadImageMod from "../src/server/handlers/upload-image.js";
import * as uploadMediaMod from "../src/server/handlers/upload-media.js";
import * as uploadPdfMod from "../src/server/handlers/upload-pdf.js";
import { SseSessionManager } from "../src/server/sse-session.js";
import * as summarizeMod from "../src/summarize/pipeline.js";
import { baseFakeDeps, createTestApp } from "./helpers/server-test-utils.js";

const fakeDeps = {
  ...baseFakeDeps(),
  sseSessionManager: new SseSessionManager(),
};

/** Build a multipart FormData with a file field. */
function buildFormData(
  fileContent: Uint8Array | string,
  filename: string,
  mimeType: string,
  extraFields?: Record<string, string>,
): FormData {
  const content =
    typeof fileContent === "string" ? new TextEncoder().encode(fileContent) : fileContent;
  const blob = new Blob([content], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });
  const form = new FormData();
  form.append("file", file);
  if (extraFields) {
    for (const [key, value] of Object.entries(extraFields)) {
      form.append(key, value);
    }
  }
  return form;
}

function postMultipart(app: Hono, form: FormData) {
  return app.request("/v1/summarize", {
    method: "POST",
    body: form,
  });
}

function mockStreamSummaryForVisiblePage() {
  return vi.spyOn(summarizeMod, "streamSummaryForText").mockImplementation(async (args) => {
    const sink = args.sink;
    sink.onModelChosen("openai/gpt-4o");
    sink.writeChunk("Summary output");
    return {
      usedModel: "openai/gpt-4o",
      report: {
        llm: [
          {
            provider: "openai",
            model: "gpt-4o",
            calls: 1,
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        ],
        services: { firecrawl: { requests: 0 }, apify: { requests: 0 } },
        pipeline: null,
      },
      metrics: {
        elapsedMs: 500,
        summary: "0.5s",
        details: null,
        summaryDetailed: "0.500s",
        detailsDetailed: null,
        pipeline: null,
      },
      insights: {
        title: null,
        siteName: null,
        wordCount: 5,
        characterCount: 25,
        truncated: false,
        mediaDurationSeconds: null,
        transcriptSource: null,
        transcriptionProvider: null,
        cacheStatus: null,
        summaryFromCache: false,
        costUsd: 0.001,
        inputTokens: 100,
        outputTokens: 50,
        extractionMethod: null,
        servicesUsed: [],
        attemptedProviders: [],
        stages: [],
      },
    } as any;
  });
}

describe("POST /v1/summarize – multipart file upload validation", () => {
  it("rejects multipart with no file field", async () => {
    const app = createTestApp(fakeDeps);
    const form = new FormData();
    form.append("text", "no file here");
    const res = await postMultipart(app, form);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.message).toContain("file");
  });

  it("rejects unsupported file type with 422", async () => {
    const app = createTestApp(fakeDeps);
    const form = buildFormData("hello", "notes.txt", "text/plain");
    const res = await postMultipart(app, form);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
    expect(body.error.message).toContain("notes.txt");
  });

  it("rejects unsupported file type (.zip)", async () => {
    const app = createTestApp(fakeDeps);
    const form = buildFormData(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      "archive.zip",
      "application/zip",
    );
    const res = await postMultipart(app, form);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });
});

describe("POST /v1/summarize – PDF upload", () => {
  it("accepts PDF and calls streamSummaryForText", async () => {
    const extractSpy = vi
      .spyOn(uploadPdfMod, "extractPdfText")
      .mockResolvedValueOnce("Extracted PDF text content");
    const pipelineSpy = mockStreamSummaryForVisiblePage();

    const app = createTestApp(fakeDeps);
    const form = buildFormData(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF magic bytes
      "document.pdf",
      "application/pdf",
    );
    const res = await postMultipart(app, form);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe("Summary output");
    expect(body.metadata.title).toBe("document.pdf");
    expect(body.metadata.source).toBe("pdf:document.pdf");

    expect(extractSpy).toHaveBeenCalledOnce();
    expect(pipelineSpy).toHaveBeenCalledOnce();
    const pipelineArgs = pipelineSpy.mock.calls[0][0];
    expect(pipelineArgs.input.text).toBe("Extracted PDF text content");
    expect(pipelineArgs.input.url).toBe("upload://pdf:document.pdf");

    extractSpy.mockRestore();
    pipelineSpy.mockRestore();
  });

  it("returns 422 when PDF text extraction fails", async () => {
    const extractSpy = vi
      .spyOn(uploadPdfMod, "extractPdfText")
      .mockRejectedValueOnce(
        new Error("PDF appears to contain only images or no extractable text."),
      );

    const app = createTestApp(fakeDeps);
    const form = buildFormData(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      "scanned.pdf",
      "application/pdf",
    );
    const res = await postMultipart(app, form);

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("FILE_PROCESSING_FAILED");
    expect(body.error.message).toContain("images");

    extractSpy.mockRestore();
  });

  it("passes length and model form fields through", async () => {
    const extractSpy = vi
      .spyOn(uploadPdfMod, "extractPdfText")
      .mockResolvedValueOnce("PDF content");
    const pipelineSpy = mockStreamSummaryForVisiblePage();

    const app = createTestApp(fakeDeps);
    const form = buildFormData(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      "document.pdf",
      "application/pdf",
      { length: "short", model: "openai/gpt-4o-mini" },
    );
    const res = await postMultipart(app, form);

    expect(res.status).toBe(200);
    const pipelineArgs = pipelineSpy.mock.calls[0][0];
    expect(pipelineArgs.lengthRaw).toBe("short");
    expect(pipelineArgs.modelOverride).toBe("openai/gpt-4o-mini");

    extractSpy.mockRestore();
    pipelineSpy.mockRestore();
  });
});

describe("POST /v1/summarize – image upload", () => {
  it("accepts image and calls describeImage then streamSummaryForText", async () => {
    const describeSpy = vi.spyOn(uploadImageMod, "describeImage").mockResolvedValueOnce({
      text: "A photograph of a cat sitting on a desk.",
      modelId: "anthropic/claude-sonnet-4-20250514",
    });
    const pipelineSpy = mockStreamSummaryForVisiblePage();

    const app = createTestApp(fakeDeps);
    const form = buildFormData(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]), // PNG magic bytes
      "photo.png",
      "image/png",
    );
    const res = await postMultipart(app, form);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe("Summary output");
    expect(body.metadata.source).toBe("image:photo.png");

    expect(describeSpy).toHaveBeenCalledOnce();
    expect(pipelineSpy).toHaveBeenCalledOnce();
    const pipelineArgs = pipelineSpy.mock.calls[0][0];
    expect(pipelineArgs.input.text).toBe("A photograph of a cat sitting on a desk.");

    describeSpy.mockRestore();
    pipelineSpy.mockRestore();
  });

  it("returns 422 when image description fails", async () => {
    const describeSpy = vi
      .spyOn(uploadImageMod, "describeImage")
      .mockRejectedValueOnce(new Error("Vision model returned empty description."));

    const app = createTestApp(fakeDeps);
    const form = buildFormData(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "broken.png", "image/png");
    const res = await postMultipart(app, form);

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("FILE_PROCESSING_FAILED");

    describeSpy.mockRestore();
  });
});

describe("POST /v1/summarize – audio/video upload", () => {
  it("accepts audio and calls transcribeUploadedMedia then pipeline", async () => {
    const transcribeSpy = vi
      .spyOn(uploadMediaMod, "transcribeUploadedMedia")
      .mockResolvedValueOnce({
        transcript: "This is the transcribed audio content.",
        durationSeconds: 120,
      });
    const pipelineSpy = mockStreamSummaryForVisiblePage();

    const app = createTestApp(fakeDeps);
    const form = buildFormData(new Uint8Array(100), "recording.mp3", "audio/mpeg");
    const res = await postMultipart(app, form);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe("Summary output");
    expect(body.metadata.source).toBe("audio:recording.mp3");

    expect(transcribeSpy).toHaveBeenCalledOnce();
    expect(pipelineSpy).toHaveBeenCalledOnce();
    const pipelineArgs = pipelineSpy.mock.calls[0][0];
    expect(pipelineArgs.input.text).toBe("This is the transcribed audio content.");

    transcribeSpy.mockRestore();
    pipelineSpy.mockRestore();
  });

  it("accepts video upload", async () => {
    const transcribeSpy = vi
      .spyOn(uploadMediaMod, "transcribeUploadedMedia")
      .mockResolvedValueOnce({
        transcript: "Video transcript content.",
        durationSeconds: 300,
      });
    const pipelineSpy = mockStreamSummaryForVisiblePage();

    const app = createTestApp(fakeDeps);
    const form = buildFormData(new Uint8Array(100), "clip.mp4", "video/mp4");
    const res = await postMultipart(app, form);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metadata.source).toBe("video:clip.mp4");

    transcribeSpy.mockRestore();
    pipelineSpy.mockRestore();
  });

  it("returns 422 when transcription fails", async () => {
    const transcribeSpy = vi
      .spyOn(uploadMediaMod, "transcribeUploadedMedia")
      .mockRejectedValueOnce(
        new Error(
          "Transcription produced no text. The audio may be silent or the file format unsupported.",
        ),
      );

    const app = createTestApp(fakeDeps);
    const form = buildFormData(new Uint8Array(100), "silent.mp3", "audio/mpeg");
    const res = await postMultipart(app, form);

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("FILE_PROCESSING_FAILED");
    expect(body.error.message).toContain("silent");

    transcribeSpy.mockRestore();
  });
});
