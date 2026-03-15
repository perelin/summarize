import { describe, expect, it } from "vitest";
import { ASSEMBLYAI_TRANSCRIPTION_MODEL_ID } from "../src/core/transcription/whisper/assemblyai.js";
import {
  buildCloudModelIdChain,
  buildCloudProviderHint,
  cloudProviderLabel,
  formatCloudFallbackTargets,
  resolveCloudProviderOrder,
} from "../src/core/transcription/whisper/cloud-providers.js";

describe("transcription/whisper cloud providers", () => {
  it("resolves cloud provider order from configured keys", () => {
    expect(
      resolveCloudProviderOrder({
        assemblyaiApiKey: "AAI",
        mistralApiKey: "MISTRAL",
        geminiApiKey: "GEMINI",
        openaiApiKey: "OPENAI",
        falApiKey: "FAL",
      }),
    ).toEqual(["mistral", "assemblyai", "gemini", "openai", "fal"]);
  });

  it("formats provider labels for fallback notes", () => {
    expect(cloudProviderLabel("openai", false)).toBe("Whisper/OpenAI");
    expect(formatCloudFallbackTargets(["assemblyai", "gemini", "openai"])).toBe(
      "AssemblyAI/Gemini/OpenAI",
    );
  });

  it("builds provider and model chains from availability", () => {
    expect(
      buildCloudProviderHint({
        hasAssemblyAi: true,
        hasMistral: false,
        hasGemini: true,
        hasOpenai: true,
        hasFal: false,
      }),
    ).toBe("assemblyai->gemini->openai");

    expect(
      buildCloudModelIdChain({
        availability: {
          hasAssemblyAi: true,
          hasMistral: true,
          hasGemini: true,
          hasOpenai: true,
          hasFal: true,
        },
        geminiModelId: "gemini-2.5-flash",
      }),
    ).toBe(
      `voxtral-mini-latest->${ASSEMBLYAI_TRANSCRIPTION_MODEL_ID}->google/gemini-2.5-flash->whisper-1->fal-ai/wizper`,
    );
  });

  it("returns null chains when no cloud providers are available", () => {
    expect(
      buildCloudProviderHint({
        hasAssemblyAi: false,
        hasMistral: false,
        hasGemini: false,
        hasOpenai: false,
        hasFal: false,
      }),
    ).toBeNull();

    expect(
      buildCloudModelIdChain({
        availability: {
          hasAssemblyAi: false,
          hasMistral: false,
          hasGemini: false,
          hasOpenai: false,
          hasFal: false,
        },
        geminiModelId: "gemini-2.5-flash",
      }),
    ).toBeNull();
  });
});
