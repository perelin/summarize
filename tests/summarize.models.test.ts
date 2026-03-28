import { describe, expect, it, vi } from "vitest";
import { buildModelPickerOptions } from "../src/summarize/models.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "mistral/mistral-large-latest";
const DEFAULT_BASE_URL = "http://10.10.10.10:4000";

/** Minimal env that drives resolveEnvState toward known defaults. */
const emptyEnv: Record<string, string | undefined> = {};

function makeModelsResponse(ids: string[]): { ok: boolean; json: () => Promise<unknown> } {
  return {
    ok: true,
    json: () => Promise.resolve({ data: ids.map((id) => ({ id })) }),
  };
}

function createMockFetch(response: { ok: boolean; json: () => Promise<unknown> }): typeof fetch {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

function createFailingFetch(): typeof fetch {
  return vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildModelPickerOptions", () => {
  it("includes the default model even when LiteLLM returns no models", async () => {
    const fetchImpl = createMockFetch({ ok: true, json: () => Promise.resolve({ data: [] }) });

    const result = await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: emptyEnv,
      config: null,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.options.map((o) => o.id)).toContain(DEFAULT_MODEL);
    expect(result.options.length).toBe(1);
  });

  it("includes discovered models alongside the default model", async () => {
    const fetchImpl = createMockFetch(
      makeModelsResponse(["mistral/mistral-large-latest", "anthropic/claude-sonnet-4-6"]),
    );

    const result = await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: emptyEnv,
      config: null,
      fetchImpl,
    });

    const ids = result.options.map((o) => o.id);
    expect(ids).toContain(DEFAULT_MODEL);
    expect(ids).toContain("anthropic/claude-sonnet-4-6");
  });

  it("deduplicates when the default model also appears in the discovered list", async () => {
    // DEFAULT_MODEL is already pushed as the first option; if LiteLLM also
    // returns it the result should still contain it exactly once.
    const fetchImpl = createMockFetch(
      makeModelsResponse([DEFAULT_MODEL, "anthropic/claude-sonnet-4-6"]),
    );

    const result = await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: emptyEnv,
      config: null,
      fetchImpl,
    });

    const ids = result.options.map((o) => o.id);
    const occurrences = ids.filter((id) => id === DEFAULT_MODEL).length;
    expect(occurrences).toBe(1);
  });

  it("sends the API key as a Bearer token when one is configured", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeModelsResponse([])) as unknown as typeof fetch;

    await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: { LITELLM_API_KEY: "my-secret-key" },
      config: null,
      fetchImpl: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer my-secret-key");
  });

  it("omits the Authorization header when no API key is configured", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeModelsResponse([])) as unknown as typeof fetch;

    await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: emptyEnv,
      config: null,
      fetchImpl: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    // When there are no headers the implementation passes `undefined`
    expect(init.headers).toBeUndefined();
  });

  it("returns only the default model when fetch throws", async () => {
    const fetchImpl = createFailingFetch();

    const result = await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: emptyEnv,
      config: null,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.options).toHaveLength(1);
    expect(result.options[0].id).toBe(DEFAULT_MODEL);
  });

  it("returns only the default model when LiteLLM responds with a non-200 status", async () => {
    const fetchImpl = createMockFetch({ ok: false, json: () => Promise.resolve(null) });

    const result = await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: emptyEnv,
      config: null,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.options).toHaveLength(1);
    expect(result.options[0].id).toBe(DEFAULT_MODEL);
  });

  it("returns only the default model when LiteLLM returns invalid JSON", async () => {
    const fetchImpl = createMockFetch({
      ok: true,
      json: () => Promise.resolve("not-an-object"),
    });

    const result = await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: emptyEnv,
      config: null,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.options).toHaveLength(1);
    expect(result.options[0].id).toBe(DEFAULT_MODEL);
  });

  it("returns the correct currentModel from env override", async () => {
    const fetchImpl = createMockFetch({ ok: true, json: () => Promise.resolve({ data: [] }) });
    const customModel = "openai/gpt-4o";

    const result = await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: { SUMMARIZE_MODEL: customModel },
      config: null,
      fetchImpl,
    });

    expect(result.currentModel).toBe(customModel);
    expect(result.options[0].id).toBe(customModel);
    expect(result.options[0].label).toBe(`Default: ${customModel}`);
  });

  it("returns the correct litellmBaseUrl in the output", async () => {
    const fetchImpl = createMockFetch({ ok: true, json: () => Promise.resolve({ data: [] }) });
    const customBaseUrl = "http://my-gateway:8080";

    const result = await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: { LITELLM_BASE_URL: customBaseUrl },
      config: null,
      fetchImpl,
    });

    expect(result.litellmBaseUrl).toBe(customBaseUrl);
  });

  it("uses the default litellmBaseUrl when none is configured", async () => {
    const fetchImpl = createMockFetch({ ok: true, json: () => Promise.resolve({ data: [] }) });

    const result = await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: emptyEnv,
      config: null,
      fetchImpl,
    });

    expect(result.litellmBaseUrl).toBe(DEFAULT_BASE_URL);
  });

  it("fetches from the correct /models endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeModelsResponse([])) as unknown as typeof fetch;
    const customBaseUrl = "http://my-gateway:8080";

    await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: { LITELLM_BASE_URL: customBaseUrl },
      config: null,
      fetchImpl: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe(`${customBaseUrl}/models`);
  });

  it("sorts and deduplicates model IDs returned by LiteLLM", async () => {
    const fetchImpl = createMockFetch(
      makeModelsResponse([
        "openai/gpt-4o",
        "anthropic/claude-sonnet-4-6",
        "openai/gpt-4o", // duplicate
      ]),
    );

    const result = await buildModelPickerOptions({
      env: emptyEnv,
      envForRun: emptyEnv,
      config: null,
      fetchImpl,
    });

    const discoveredIds = result.options.slice(1).map((o) => o.id); // skip default
    // Should be sorted alphabetically
    expect(discoveredIds).toEqual([...discoveredIds].sort((a, b) => a.localeCompare(b)));
    // Each ID should appear exactly once
    const unique = new Set(discoveredIds);
    expect(unique.size).toBe(discoveredIds.length);
  });
});
