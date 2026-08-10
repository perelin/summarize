import { describe, expect, it, vi } from "vitest";

const MISTRAL_URL = "https://api.mistral.ai/v1/audio/transcriptions";

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input.toString();
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Keep local providers out of the way so the cloud ordering is what is tested. */
function isolateFromLocalProviders() {
  vi.stubEnv("SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP", "1");
  vi.stubEnv("SUMMARIZE_TRANSCRIBER", "whisper");
}

describe("transcription/whisper provider order", () => {
  it("prefers Mistral over Groq so transcripts keep speaker labels", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      calls.push(url);
      if (url === MISTRAL_URL) {
        return jsonResponse({
          text: "flat",
          segments: [
            { text: "Moin.", speaker_id: "speaker_1" },
            { text: "Servus.", speaker_id: "speaker_2" },
          ],
        });
      }
      throw new Error(`unexpected request to ${url}`);
    });

    try {
      isolateFromLocalProviders();
      vi.stubGlobal("fetch", fetchMock);
      const { transcribeMediaWithWhisper } = await import("../src/core/transcription/whisper.js");

      const result = await transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: "audio/mpeg",
        filename: "audio.mp3",
        groqApiKey: "GROQ",
        mistralApiKey: "MISTRAL",
        openaiApiKey: null,
        falApiKey: null,
        env: {},
      });

      expect(result.provider).toBe("mistral");
      expect(result.text).toBe("Speaker 1: Moin.\n\nSpeaker 2: Servus.");
      expect(calls).toEqual([MISTRAL_URL]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("falls back to Groq when Mistral fails, without retrying Mistral", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      calls.push(url);
      if (url === MISTRAL_URL) {
        return new Response("nope", { status: 500, headers: { "content-type": "text/plain" } });
      }
      return jsonResponse({ text: "groq transcript" });
    });

    try {
      isolateFromLocalProviders();
      vi.stubGlobal("fetch", fetchMock);
      const { transcribeMediaWithWhisper } = await import("../src/core/transcription/whisper.js");

      const result = await transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: "audio/mpeg",
        filename: "audio.mp3",
        groqApiKey: "GROQ",
        mistralApiKey: "MISTRAL",
        openaiApiKey: null,
        falApiKey: null,
        env: {},
      });

      expect(result.provider).toBe("groq");
      expect(result.text).toBe("groq transcript");
      expect(calls.filter((url) => url === MISTRAL_URL)).toHaveLength(1);
      expect(result.notes.some((note) => note.startsWith("Mistral transcription failed"))).toBe(
        true,
      );
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("keeps using Groq first when no Mistral key is configured", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(urlOf(input));
      return jsonResponse({ text: "groq transcript" });
    });

    try {
      isolateFromLocalProviders();
      vi.stubGlobal("fetch", fetchMock);
      const { transcribeMediaWithWhisper } = await import("../src/core/transcription/whisper.js");

      const result = await transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: "audio/mpeg",
        filename: "audio.mp3",
        groqApiKey: "GROQ",
        mistralApiKey: null,
        openaiApiKey: null,
        falApiKey: null,
        env: {},
      });

      expect(result.provider).toBe("groq");
      expect(calls.some((url) => url === MISTRAL_URL)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("skips the single-request Mistral attempt for oversized media", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(urlOf(input));
      return jsonResponse({ text: "groq transcript" });
    });

    try {
      isolateFromLocalProviders();
      vi.stubGlobal("fetch", fetchMock);
      const { MAX_MISTRAL_UPLOAD_BYTES } =
        await import("../src/core/transcription/whisper/constants.js");
      const { transcribeMediaWithWhisper } = await import("../src/core/transcription/whisper.js");

      const result = await transcribeMediaWithWhisper({
        bytes: new Uint8Array(MAX_MISTRAL_UPLOAD_BYTES + 1),
        mediaType: "audio/mpeg",
        filename: "audio.mp3",
        groqApiKey: "GROQ",
        mistralApiKey: "MISTRAL",
        openaiApiKey: null,
        falApiKey: null,
        env: {},
      });

      expect(result.provider).toBe("groq");
      expect(calls.some((url) => url === MISTRAL_URL)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
