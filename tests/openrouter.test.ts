import { describe, expect, it, vi } from "vitest";
import { buildOpenRouterNoAllowedProvidersMessage } from "../src/run/openrouter.js";

describe("buildOpenRouterNoAllowedProvidersMessage", () => {
  it("returns a message listing tried models", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false });
    const result = await buildOpenRouterNoAllowedProvidersMessage({
      attempts: [
        { userModelId: "openrouter/anthropic/claude-3-sonnet" },
        { userModelId: "openrouter/openai/gpt-4" },
      ],
      fetchImpl: mockFetch as unknown as typeof fetch,
      timeoutMs: 5000,
    });
    expect(result).toContain("anthropic/claude-3-sonnet");
    expect(result).toContain("openai/gpt-4");
    expect(result).toContain("OpenRouter could not route");
  });

  it("filters out non-openrouter model IDs from tried list", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false });
    const result = await buildOpenRouterNoAllowedProvidersMessage({
      attempts: [
        { userModelId: "openrouter/anthropic/claude-3-sonnet" },
        { userModelId: "gpt-4" }, // not openrouter prefixed
      ],
      fetchImpl: mockFetch as unknown as typeof fetch,
      timeoutMs: 5000,
    });
    expect(result).toContain("anthropic/claude-3-sonnet");
    expect(result).not.toContain("gpt-4");
  });

  it("includes provider hints when endpoint API returns providers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          endpoints: [
            { provider_name: "Together" },
            { provider_name: "Fireworks" },
          ],
        },
      }),
    });
    const result = await buildOpenRouterNoAllowedProvidersMessage({
      attempts: [{ userModelId: "openrouter/meta/llama-3" }],
      fetchImpl: mockFetch as unknown as typeof fetch,
      timeoutMs: 5000,
    });
    expect(result).toContain("Providers to allow:");
    expect(result).toContain("Fireworks");
    expect(result).toContain("Together");
  });

  it("handles fetch errors gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await buildOpenRouterNoAllowedProvidersMessage({
      attempts: [{ userModelId: "openrouter/anthropic/claude-3-sonnet" }],
      fetchImpl: mockFetch as unknown as typeof fetch,
      timeoutMs: 5000,
    });
    // Should still return a message without providers
    expect(result).toContain("OpenRouter could not route");
    expect(result).not.toContain("Providers to allow:");
  });

  it("truncates long model lists", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false });
    const attempts = Array.from({ length: 10 }, (_, i) => ({
      userModelId: `openrouter/provider/model-${i}`,
    }));
    const result = await buildOpenRouterNoAllowedProvidersMessage({
      attempts,
      fetchImpl: mockFetch as unknown as typeof fetch,
      timeoutMs: 5000,
    });
    expect(result).toContain("+4 more");
  });
});
