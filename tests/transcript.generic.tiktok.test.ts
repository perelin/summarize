import { describe, expect, it, vi } from "vitest";
import { fetchTranscript } from "../src/core/content/transcript/providers/generic.js";

const fetchTranscriptWithYtDlp = vi.fn(async () => ({
  text: "tiktok transcript",
  provider: "openai",
  notes: [],
  error: null,
}));

vi.mock("../src/core/content/transcript/providers/youtube/yt-dlp.js", () => ({
  fetchTranscriptWithYtDlp,
}));

const buildOptions = (overrides?: Partial<Parameters<typeof fetchTranscript>[1]>) => ({
  fetch: fetch,
  scrapeWithFirecrawl: null,
  apifyApiToken: null,
  youtubeTranscriptMode: "auto",
  mediaTranscriptMode: "auto",
  ytDlpPath: "/usr/bin/yt-dlp",
  groqApiKey: null,
  falApiKey: null,
  openaiApiKey: "test",
  resolveTwitterCookies: null,
  onProgress: null,
  ...overrides,
});

describe("generic transcript provider (TikTok)", () => {
  it("routes TikTok video URLs through yt-dlp", async () => {
    const result = await fetchTranscript(
      { url: "https://www.tiktok.com/@user/video/1234567890", html: null, resourceKey: null },
      buildOptions(),
    );

    expect(fetchTranscriptWithYtDlp).toHaveBeenCalledTimes(1);
    expect(fetchTranscriptWithYtDlp).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://www.tiktok.com/@user/video/1234567890" }),
    );
    expect(result.source).toBe("yt-dlp");
    expect(result.text).toContain("tiktok transcript");
    expect(result.metadata?.kind).toBe("tiktok");
    expect(result.attemptedProviders).toContain("yt-dlp");
  });

  it("does not resolve Twitter cookies for TikTok URLs", async () => {
    fetchTranscriptWithYtDlp.mockClear();
    const resolveTwitterCookies = vi.fn(async () => null);

    await fetchTranscript(
      { url: "https://www.tiktok.com/@user/video/1234567890", html: null, resourceKey: null },
      buildOptions({ resolveTwitterCookies }),
    );

    expect(resolveTwitterCookies).not.toHaveBeenCalled();
  });

  it("returns missing_yt_dlp when yt-dlp is not configured", async () => {
    fetchTranscriptWithYtDlp.mockClear();

    const result = await fetchTranscript(
      { url: "https://www.tiktok.com/@user/video/1234567890", html: null, resourceKey: null },
      buildOptions({ ytDlpPath: null }),
    );

    expect(fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
    expect(result.text).toBeNull();
    expect(result.metadata?.kind).toBe("tiktok");
    expect(result.metadata?.reason).toBe("missing_yt_dlp");
  });

  it("routes vm.tiktok.com short links through yt-dlp", async () => {
    fetchTranscriptWithYtDlp.mockClear();

    const result = await fetchTranscript(
      { url: "https://vm.tiktok.com/ZMhAbCdEf/", html: null, resourceKey: null },
      buildOptions(),
    );

    expect(fetchTranscriptWithYtDlp).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("yt-dlp");
    expect(result.metadata?.kind).toBe("tiktok");
  });
});
