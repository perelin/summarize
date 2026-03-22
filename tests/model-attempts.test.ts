import { describe, expect, it, vi } from "vitest";
import { runModelAttempts } from "../src/run/model-attempts.js";
import type { ModelAttempt } from "../src/run/types.js";

function makeAttempt(overrides: Partial<ModelAttempt> = {}): ModelAttempt {
  return {
    transport: "native",
    userModelId: "test-model",
    llmModelId: "test-model",
    openrouterProviders: null,
    forceOpenRouter: false,
    requiredEnv: "OPENAI_API_KEY",
    ...overrides,
  };
}

describe("runModelAttempts", () => {
  it("returns result from first successful attempt", async () => {
    const attempt = makeAttempt();
    const result = await runModelAttempts({
      attempts: [attempt],
      isFallbackModel: false,
      isNamedModelSelection: false,
      envHasKeyFor: () => true,
      formatMissingModelError: () => "missing",
      runAttempt: async () => "success",
    });
    expect(result.result).toBe("success");
    expect(result.usedAttempt).toBe(attempt);
    expect(result.lastError).toBe(null);
  });

  it("throws when fixed model has no API key", async () => {
    const attempt = makeAttempt();
    await expect(
      runModelAttempts({
        attempts: [attempt],
        isFallbackModel: false,
        isNamedModelSelection: false,
        envHasKeyFor: () => false,
        formatMissingModelError: () => "API key missing",
        runAttempt: async () => "success",
      }),
    ).rejects.toThrow("API key missing");
  });

  it("skips attempts without API keys in fallback mode", async () => {
    const attempt1 = makeAttempt({ userModelId: "model-1", requiredEnv: "OPENAI_API_KEY" });
    const attempt2 = makeAttempt({ userModelId: "model-2", requiredEnv: "ANTHROPIC_API_KEY" });
    const onAutoSkip = vi.fn();
    const result = await runModelAttempts({
      attempts: [attempt1, attempt2],
      isFallbackModel: true,
      isNamedModelSelection: false,
      envHasKeyFor: (env) => env === "ANTHROPIC_API_KEY",
      formatMissingModelError: () => "missing",
      onAutoSkip,
      runAttempt: async () => "from-model-2",
    });
    expect(result.result).toBe("from-model-2");
    expect(result.usedAttempt).toBe(attempt2);
    expect(onAutoSkip).toHaveBeenCalledWith(attempt1);
  });

  it("falls through to next attempt on error in fallback mode", async () => {
    const attempt1 = makeAttempt({ userModelId: "model-1" });
    const attempt2 = makeAttempt({ userModelId: "model-2" });
    const onAutoFailure = vi.fn();
    let callCount = 0;
    const result = await runModelAttempts({
      attempts: [attempt1, attempt2],
      isFallbackModel: true,
      isNamedModelSelection: false,
      envHasKeyFor: () => true,
      formatMissingModelError: () => "missing",
      onAutoFailure,
      runAttempt: async () => {
        callCount++;
        if (callCount === 1) throw new Error("first failed");
        return "second-ok";
      },
    });
    expect(result.result).toBe("second-ok");
    expect(result.usedAttempt).toBe(attempt2);
    expect(onAutoFailure).toHaveBeenCalledOnce();
  });

  it("throws on error for fixed (non-fallback) model", async () => {
    const attempt = makeAttempt();
    await expect(
      runModelAttempts({
        attempts: [attempt],
        isFallbackModel: false,
        isNamedModelSelection: false,
        envHasKeyFor: () => true,
        formatMissingModelError: () => "missing",
        runAttempt: async () => {
          throw new Error("model error");
        },
      }),
    ).rejects.toThrow("model error");
  });

  it("tracks missing envs for named model selection in fallback mode", async () => {
    const attempt = makeAttempt({ requiredEnv: "GEMINI_API_KEY" });
    const result = await runModelAttempts({
      attempts: [attempt],
      isFallbackModel: true,
      isNamedModelSelection: true,
      envHasKeyFor: () => false,
      formatMissingModelError: () => "missing",
      runAttempt: async () => "never",
    });
    expect(result.result).toBe(null);
    expect(result.missingRequiredEnvs.has("GEMINI_API_KEY")).toBe(true);
  });

  it("detects OpenRouter no-allowed-providers error", async () => {
    const attempt = makeAttempt({ userModelId: "openrouter/anthropic/claude-3" });
    const result = await runModelAttempts({
      attempts: [attempt],
      isFallbackModel: true,
      isNamedModelSelection: true,
      envHasKeyFor: () => true,
      formatMissingModelError: () => "missing",
      runAttempt: async () => {
        throw new Error("No allowed providers are available for the selected model");
      },
    });
    expect(result.sawOpenRouterNoAllowedProviders).toBe(true);
    expect(result.result).toBe(null);
  });

  it("returns null result when all attempts fail in fallback mode", async () => {
    const attempt1 = makeAttempt({ userModelId: "model-1" });
    const attempt2 = makeAttempt({ userModelId: "model-2" });
    const result = await runModelAttempts({
      attempts: [attempt1, attempt2],
      isFallbackModel: true,
      isNamedModelSelection: false,
      envHasKeyFor: () => true,
      formatMissingModelError: () => "missing",
      runAttempt: async () => {
        throw new Error("failed");
      },
    });
    expect(result.result).toBe(null);
    expect(result.usedAttempt).toBe(null);
    expect(result.lastError).toBeInstanceOf(Error);
  });

  it("calls onFixedModelError for non-fallback model failure", async () => {
    const attempt = makeAttempt();
    const onFixedModelError = vi.fn((_attempt: ModelAttempt, error: unknown) => {
      throw error;
    }) as (attempt: ModelAttempt, error: unknown) => never;

    await expect(
      runModelAttempts({
        attempts: [attempt],
        isFallbackModel: false,
        isNamedModelSelection: false,
        envHasKeyFor: () => true,
        formatMissingModelError: () => "missing",
        onFixedModelError,
        runAttempt: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    expect(onFixedModelError).toHaveBeenCalledOnce();
  });
});
