import { describe, expect, it, vi } from "vitest";

describe("transcription/whisper mistral", () => {
  it("calls Mistral Voxtral and returns transcribed text", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as unknown;
      expect(body).toBeInstanceOf(FormData);

      const form = body as FormData;
      expect(form.get("model")).toBe("voxtral-mini-latest");

      const url = typeof _input === "string" ? _input : _input.toString();
      expect(url).toBe("https://api.mistral.ai/v1/audio/transcriptions");

      return new Response(JSON.stringify({ text: "hello from mistral" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    try {
      vi.stubGlobal("fetch", fetchMock);
      const { transcribeWithMistral } =
        await import("../packages/core/src/transcription/whisper/mistral.js");

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
        await import("../packages/core/src/transcription/whisper/mistral.js");

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
        await import("../packages/core/src/transcription/whisper/mistral.js");

      await expect(
        transcribeWithMistral(
          new Uint8Array([1, 2, 3]),
          "audio/mpeg",
          "audio.mp3",
          "MISTRAL_KEY",
        ),
      ).rejects.toThrow("Mistral transcription failed (500)");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
