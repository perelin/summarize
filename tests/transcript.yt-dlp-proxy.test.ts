import { describe, expect, it, vi } from "vitest";
import {
  buildYtDlpProxyAttempts,
  isProxyFailure,
  MediaProxyError,
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

    it("marks the failure as a proxy failure when the proxy attempt was rejected", async () => {
      const run = vi
        .fn()
        .mockRejectedValueOnce(new Error("Sign in to confirm you're not a bot"))
        .mockRejectedValueOnce(
          new Error(
            "yt-dlp exited with code 1: ERROR: Tunnel connection failed: 407 Proxy Authentication Required",
          ),
        );

      const error = await runWithYtDlpProxyFallback({
        proxyUrl: "http://proxy:7777",
        operation: "download",
        run,
      }).catch((err: unknown) => err as Error);

      expect(error).toBeInstanceOf(MediaProxyError);
      expect((error as MediaProxyError).code).toBe("PROXY_FAILED");
      expect(isProxyFailure(error)).toBe(true);
    });

    it("does not mark a failure as a proxy failure when only content errors occurred", async () => {
      const run = vi
        .fn()
        .mockRejectedValueOnce(new Error("Sign in to confirm you're not a bot"))
        .mockRejectedValueOnce(new Error("ERROR: Video unavailable"));

      const error = await runWithYtDlpProxyFallback({
        proxyUrl: "http://proxy:7777",
        operation: "download",
        run,
      }).catch((err: unknown) => err as Error);

      expect(error).not.toBeInstanceOf(MediaProxyError);
      expect(isProxyFailure(error)).toBe(false);
    });
  });

  describe("isProxyFailure", () => {
    it("recognizes the operator-level proxy failures", () => {
      expect(isProxyFailure(new Error("407 Proxy Authentication Required"))).toBe(true);
      expect(isProxyFailure(new Error("Access denied: traffic limit reached"))).toBe(true);
      expect(
        isProxyFailure(new Error("Tunnel connection failed: 407 Proxy Authentication Required")),
      ).toBe(true);
      expect(isProxyFailure("ProxyError: cannot connect")).toBe(true);
    });

    it("ignores content failures and empty values", () => {
      expect(isProxyFailure(new Error("Sign in to confirm you're not a bot"))).toBe(false);
      expect(isProxyFailure(new Error("Video unavailable"))).toBe(false);
      expect(isProxyFailure(null)).toBe(false);
      expect(isProxyFailure(undefined)).toBe(false);
    });
  });
});
