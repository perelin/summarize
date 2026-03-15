import { describe, expect, it } from "vitest";
import { isTikTokVideoUrl } from "../src/core/content/link-preview/content/tiktok-utils.js";

describe("isTikTokVideoUrl", () => {
  it("matches standard video URLs", () => {
    expect(isTikTokVideoUrl("https://www.tiktok.com/@username/video/1234567890")).toBe(true);
    expect(isTikTokVideoUrl("https://tiktok.com/@user/video/9999999999")).toBe(true);
  });

  it("matches vm.tiktok.com short links", () => {
    expect(isTikTokVideoUrl("https://vm.tiktok.com/ZMhAbCdEf/")).toBe(true);
    expect(isTikTokVideoUrl("https://vm.tiktok.com/CODE123")).toBe(true);
  });

  it("matches tiktok.com/t/ short links", () => {
    expect(isTikTokVideoUrl("https://www.tiktok.com/t/ZTRxyz123/")).toBe(true);
    expect(isTikTokVideoUrl("https://tiktok.com/t/ABC")).toBe(true);
  });

  it("rejects non-video TikTok pages", () => {
    expect(isTikTokVideoUrl("https://www.tiktok.com/@username")).toBe(false);
    expect(isTikTokVideoUrl("https://www.tiktok.com/explore")).toBe(false);
    expect(isTikTokVideoUrl("https://www.tiktok.com/")).toBe(false);
  });

  it("rejects vm.tiktok.com root", () => {
    expect(isTikTokVideoUrl("https://vm.tiktok.com/")).toBe(false);
  });

  it("rejects non-TikTok URLs", () => {
    expect(isTikTokVideoUrl("https://example.com/@user/video/123")).toBe(false);
    expect(isTikTokVideoUrl("https://youtube.com/watch?v=abc")).toBe(false);
  });

  it("handles invalid URLs gracefully", () => {
    expect(isTikTokVideoUrl("not-a-url")).toBe(false);
    expect(isTikTokVideoUrl("")).toBe(false);
  });
});
