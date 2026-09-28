import { describe, expect, it, vi } from "vitest";
import {
  buildYtDlpProxyAttempts,
  resolveYtDlpProxyUrl,
  runWithYtDlpProxyFallback,
  ytDlpProxyArgs,
} from "../src/core/content/transcript/providers/youtube/yt-dlp-proxy.js";

describe("yt-dlp proxy fallback", () => {
  describe("resolveYtDlpProxyUrl", () => {
    it("returns a trimmed proxy URL", () => {
      expect(resolveYtDlpProxyUrl({ YT_DLP_PROXY: "  http://proxy:7777  " })).toBe(
        "http://proxy:7777",
      );
    });

    it("treats missing and blank values as no proxy", () => {
      expect(resolveYtDlpProxyUrl({})).toBeNull();
      expect(resolveYtDlpProxyUrl({ YT_DLP_PROXY: "" })).toBeNull();
      expect(resolveYtDlpProxyUrl({ YT_DLP_PROXY: "   " })).toBeNull();
    });
  });

  describe("attempt planning", () => {
    it("only connects directly when no proxy is configured", () => {
      expect(buildYtDlpProxyAttempts(null)).toEqual([{ label: "direct", proxyUrl: null }]);
    });

    it("adds the proxy as a second attempt", () => {
      expect(buildYtDlpProxyAttempts("http://proxy:7777")).toEqual([
        { label: "direct", proxyUrl: null },
        { label: "proxy", proxyUrl: "http://proxy:7777" },
      ]);
    });

    it("encodes the proxy flag, using an empty value for direct connections", () => {
      expect(ytDlpProxyArgs({ label: "direct", proxyUrl: null })).toEqual(["--proxy", ""]);
      expect(ytDlpProxyArgs({ label: "proxy", proxyUrl: "http://proxy:7777" })).toEqual([
        "--proxy",
        "http://proxy:7777",
      ]);
    });
  });

  describe("runWithYtDlpProxyFallback", () => {
    it("runs once and propagates the original error when no proxy is configured", async () => {
      const failure = new Error("HTTP Error 403: Forbidden");
      const run = vi.fn().mockRejectedValue(failure);

      await expect(
        runWithYtDlpProxyFallback({ proxyUrl: null, operation: "download", run }),
      ).rejects.toBe(failure);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith(["--proxy", ""]);
    });

    it("retries through the proxy after a failed direct attempt", async () => {
      const notes: string[] = [];
      const beforeRetry = vi.fn();
      const run = vi
        .fn()
        .mockRejectedValueOnce(new Error("HTTP Error 403: Forbidden"))
        .mockResolvedValueOnce("ok");

      await expect(
        runWithYtDlpProxyFallback({
          proxyUrl: "http://proxy:7777",
          operation: "download",
          run,
          beforeRetry,
          onNote: (note) => notes.push(note),
        }),
      ).resolves.toBe("ok");

      expect(run).toHaveBeenNthCalledWith(1, ["--proxy", ""]);
      expect(run).toHaveBeenNthCalledWith(2, ["--proxy", "http://proxy:7777"]);
      expect(beforeRetry).toHaveBeenCalledTimes(1);
      expect(notes.join(" ")).toMatch(/direct attempt failed; retrying via YT_DLP_PROXY/);
    });

    it("reports both attempts when direct and proxy runs fail", async () => {
      const directError = new Error("HTTP Error 403: Forbidden");
      const proxyError = new Error("407 Proxy Authentication Required");
      const run = vi.fn().mockRejectedValueOnce(directError).mockRejectedValueOnce(proxyError);

      const error = await runWithYtDlpProxyFallback({
        proxyUrl: "http://proxy:7777",
        operation: "download",
        run,
      }).catch((err: unknown) => err as Error);

      expect(error.message).toBe(
        "direct attempt failed (HTTP Error 403: Forbidden); proxy attempt failed (407 Proxy Authentication Required)",
      );
      expect(error.cause).toBe(proxyError);
      expect(run).toHaveBeenCalledTimes(2);
    });
  });
});
