import { describe, expect, it } from "vitest";
import type { SummarizeConfig } from "../src/config.js";
import { resolveEnvState } from "../src/run/run-env.js";

describe("run env", () => {
  it("resolves default openrouter base URL when no config or env", () => {
    const state = resolveEnvState({
      env: {},
      envForRun: {},
      config: null,
    });

    expect(state.openrouterBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(state.openrouterApiKey).toBeNull();
    expect(state.model).toBe("deepseek/deepseek-v4-flash-0731");
    expect(state.sttModel).toBe("mistral/voxtral-mini-latest");
  });

  it("resolves openrouter from config", () => {
    const config: SummarizeConfig = {
      openrouter: { baseUrl: "http://localhost:4000", apiKey: "sk-test" },
    };

    const state = resolveEnvState({
      env: {},
      envForRun: {},
      config,
    });

    expect(state.openrouterBaseUrl).toBe("http://localhost:4000");
    expect(state.openrouterApiKey).toBe("sk-test");
  });

  it("resolves model from config", () => {
    const config: SummarizeConfig = {
      model: "openai/gpt-5.2",
    };

    const state = resolveEnvState({
      env: {},
      envForRun: {},
      config,
    });

    expect(state.model).toBe("openai/gpt-5.2");
  });

  it("env overrides config for openrouter and model", () => {
    const config: SummarizeConfig = {
      openrouter: { baseUrl: "http://config:4000" },
      model: "config-model",
    };

    const state = resolveEnvState({
      env: {},
      envForRun: {
        OPENROUTER_BASE_URL: "http://env:4000",
        SUMMARIZE_MODEL: "env-model",
      },
      config,
    });

    expect(state.openrouterBaseUrl).toBe("http://env:4000");
    expect(state.model).toBe("env-model");
  });

  it("resolves firecrawl and apify from env", () => {
    const state = resolveEnvState({
      env: {},
      envForRun: {
        FIRECRAWL_API_KEY: "fc-key",
        APIFY_API_TOKEN: "apify-token",
      },
      config: null,
    });

    expect(state.firecrawlApiKey).toBe("fc-key");
    expect(state.firecrawlConfigured).toBe(true);
    expect(state.apifyToken).toBe("apify-token");
  });

  it("resolves sttModel from config", () => {
    const config: SummarizeConfig = {
      sttModel: "mistral/voxtral-large-latest",
    };

    const state = resolveEnvState({
      env: {},
      envForRun: {},
      config,
    });

    expect(state.sttModel).toBe("mistral/voxtral-large-latest");
  });
});
