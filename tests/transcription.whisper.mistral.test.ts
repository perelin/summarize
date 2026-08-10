import { describe, expect, it, vi } from "vitest";

const DIARIZED_SEGMENTS = [
  {
    type: "transcription_segment",
    text: "Hallo zusammen.",
    start: 6.3,
    end: 12.2,
    speaker_id: "speaker_1",
  },
  {
    type: "transcription_segment",
    text: " Wer hacken will, muss freundlich sein.",
    start: 12.6,
    end: 15,
    speaker_id: "speaker_1",
  },
  {
    type: "transcription_segment",
    text: " Das sehe ich anders.",
    start: 15.6,
    end: 17.3,
    speaker_id: "speaker_2",
  },
  {
    type: "transcription_segment",
    text: " Erzähl mal.",
    start: 17.8,
    end: 19.1,
    speaker_id: "speaker_1",
  },
];

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("transcription/whisper mistral", () => {
  it("calls Mistral Voxtral and returns transcribed text", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as unknown;
      expect(body).toBeInstanceOf(FormData);

      const form = body as FormData;
      expect(form.get("model")).toBe("voxtral-mini-latest");

      const url = typeof _input === "string" ? _input : _input.toString();
      expect(url).toBe("https://api.mistral.ai/v1/audio/transcriptions");

      return jsonResponse({ text: "hello from mistral" });
    });

    try {
      vi.stubGlobal("fetch", fetchMock);
      const { transcribeWithMistral } =
        await import("../src/core/transcription/whisper/mistral.js");

      const result = await transcribeWithMistral(
        new Uint8Array([1, 2, 3]),
        "audio/mpeg",
        "audio.mp3",
        "MISTRAL_KEY",
      );

      expect(result).toBe("hello from mistral");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requests diarization with segment granularity by default", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      // Voxtral rejects diarize=true unless segment granularity is requested too.
      expect(form.get("diarize")).toBe("true");
      expect(form.get("timestamp_granularities")).toBe("segment");
      return jsonResponse({ text: "plain", segments: [] });
    });

    try {
      vi.stubGlobal("fetch", fetchMock);
      const { transcribeWithMistral } =
        await import("../src/core/transcription/whisper/mistral.js");

      const result = await transcribeWithMistral(
        new Uint8Array([1, 2, 3]),
        "audio/mpeg",
        "audio.mp3",
        "MISTRAL_KEY",
        { env: {} },
      );

      expect(result).toBe("plain");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders speaker-labelled paragraphs and merges consecutive segments", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ text: "flat text", segments: DIARIZED_SEGMENTS }),
    );

    try {
      vi.stubGlobal("fetch", fetchMock);
      const { transcribeWithMistral } =
        await import("../src/core/transcription/whisper/mistral.js");

      const result = await transcribeWithMistral(
        new Uint8Array([1, 2, 3]),
        "audio/mpeg",
        "audio.mp3",
        "MISTRAL_KEY",
        { env: {} },
      );

      expect(result).toBe(
        [
          "Speaker 1: Hallo zusammen. Wer hacken will, muss freundlich sein.",
          "Speaker 2: Das sehe ich anders.",
          "Speaker 1: Erzähl mal.",
        ].join("\n\n"),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns plain text when only one speaker was detected", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        text: "one voice only",
        segments: DIARIZED_SEGMENTS.filter((segment) => segment.speaker_id === "speaker_1"),
      }),
    );

    try {
      vi.stubGlobal("fetch", fetchMock);
      const { transcribeWithMistral } =
        await import("../src/core/transcription/whisper/mistral.js");

      const result = await transcribeWithMistral(
        new Uint8Array([1, 2, 3]),
        "audio/mpeg",
        "audio.mp3",
        "MISTRAL_KEY",
        { env: {} },
      );

      expect(result).toBe("one voice only");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits diarization when SUMMARIZE_MISTRAL_DIARIZE disables it", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get("diarize")).toBeNull();
      expect(form.get("timestamp_granularities")).toBeNull();
      return jsonResponse({ text: "flat text", segments: DIARIZED_SEGMENTS });
    });

    try {
      vi.stubGlobal("fetch", fetchMock);
      const { transcribeWithMistral } =
        await import("../src/core/transcription/whisper/mistral.js");

      const result = await transcribeWithMistral(
        new Uint8Array([1, 2, 3]),
        "audio/mpeg",
        "audio.mp3",
        "MISTRAL_KEY",
        { env: { SUMMARIZE_MISTRAL_DIARIZE: "0" } },
      );

      expect(result).toBe("flat text");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns null when response has no usable text", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ foo: "bar" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    try {
      vi.stubGlobal("fetch", fetchMock);
      const { transcribeWithMistral } =
        await import("../src/core/transcription/whisper/mistral.js");

      const result = await transcribeWithMistral(
        new Uint8Array([1, 2, 3]),
        "audio/mpeg",
        "audio.mp3",
        "MISTRAL_KEY",
      );

      expect(result).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws on HTTP failure", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    });

    try {
      vi.stubGlobal("fetch", fetchMock);
      const { transcribeWithMistral } =
        await import("../src/core/transcription/whisper/mistral.js");

      await expect(
        transcribeWithMistral(new Uint8Array([1, 2, 3]), "audio/mpeg", "audio.mp3", "MISTRAL_KEY"),
      ).rejects.toThrow("Mistral transcription failed (500)");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("formatDiarizedTranscript", () => {
    it("skips unusable segments and keeps unknown speaker ids verbatim", async () => {
      const { formatDiarizedTranscript } =
        await import("../src/core/transcription/whisper/mistral.js");

      expect(
        formatDiarizedTranscript([
          null,
          { text: "  ", speaker_id: "speaker_1" },
          { text: "no speaker" },
          { text: "first", speaker_id: "speaker_1" },
          { text: "second", speaker_id: "host" },
        ]),
      ).toBe("Speaker 1: first\n\nhost: second");
    });

    it("returns null when there is nothing to label", async () => {
      const { formatDiarizedTranscript } =
        await import("../src/core/transcription/whisper/mistral.js");

      expect(formatDiarizedTranscript(undefined)).toBeNull();
      expect(formatDiarizedTranscript([])).toBeNull();
      expect(formatDiarizedTranscript([{ text: "solo", speaker_id: "speaker_1" }])).toBeNull();
    });
  });

  describe("resolveMistralDiarize", () => {
    it("defaults to enabled and honours falsy overrides", async () => {
      const { resolveMistralDiarize } =
        await import("../src/core/transcription/whisper/mistral.js");

      expect(resolveMistralDiarize({})).toBe(true);
      expect(resolveMistralDiarize({ SUMMARIZE_MISTRAL_DIARIZE: "1" })).toBe(true);
      for (const value of ["0", "false", "off", "no", "OFF"]) {
        expect(resolveMistralDiarize({ SUMMARIZE_MISTRAL_DIARIZE: value })).toBe(false);
      }
    });
  });
});
