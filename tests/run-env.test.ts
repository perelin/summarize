import { describe, expect, it } from "vitest";
import type { SummarizeConfig } from "../src/config.js";
import { resolveEnvState } from "../src/run/run-env.js";

describe("run env", () => {
  it("resolves default litellm base URL when no config or env", () => {
    const state = resolveEnvState({
      env: {},
      envForRun: {},
      config: null,
    });

    expect(state.litellmBaseUrl).toBe("http://10.10.10.10:4000");
    expect(state.litellmApiKey).toBeNull();
    expect(state.model).toBe("mistral/mistral-large-latest");
    expect(state.sttModel).toBe("mistral/voxtral-mini-latest");
  });

  it("resolves litellm from config", () => {
    const config: SummarizeConfig = {
      litellm: { baseUrl: "http://localhost:4000", apiKey: "sk-test" },
    };

    const state = resolveEnvState({
      env: {},
      envForRun: {},
      config,
    });

    expect(state.litellmBaseUrl).toBe("http://localhost:4000");
    expect(state.litellmApiKey).toBe("sk-test");
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

  it("env overrides config for litellm and model", () => {
    const config: SummarizeConfig = {
      litellm: { baseUrl: "http://config:4000" },
      model: "config-model",
    };

    const state = resolveEnvState({
      env: {},
      envForRun: {
        LITELLM_BASE_URL: "http://env:4000",
        SUMMARIZE_MODEL: "env-model",
      },
      config,
    });

    expect(state.litellmBaseUrl).toBe("http://env:4000");
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
