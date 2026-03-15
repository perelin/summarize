import { describe, expect, it } from "vitest";
import {
  envHasRequiredKey,
  requiredEnvForGatewayProvider,
  supportsDocumentAttachments,
  supportsStreaming,
} from "../src/llm/provider-capabilities.js";

describe("llm provider capabilities", () => {
  it("tracks native provider capabilities centrally", () => {
    expect(requiredEnvForGatewayProvider("google")).toBe("GEMINI_API_KEY");
    expect(supportsDocumentAttachments("google")).toBe(true);
    expect(supportsDocumentAttachments("xai")).toBe(false);
    expect(supportsStreaming("anthropic")).toBe(true);
  });

  it("handles provider env aliases", () => {
    expect(
      envHasRequiredKey(
        {
          GOOGLE_GENERATIVE_AI_API_KEY: "gemini",
        },
        "GEMINI_API_KEY",
      ),
    ).toBe(true);
    expect(envHasRequiredKey({ ZAI_API_KEY: "z" }, "Z_AI_API_KEY")).toBe(true);
    expect(envHasRequiredKey({}, "OPENAI_API_KEY")).toBe(false);
  });
});
