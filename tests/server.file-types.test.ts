import { describe, expect, it } from "vitest";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  detectUploadType,
} from "../src/server/utils/file-types.js";

describe("MAX_UPLOAD_BYTES", () => {
  it("is exactly 200 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(200 * 1024 * 1024);
  });
});

describe("ALLOWED_UPLOAD_TYPES", () => {
  it("has entries for pdf, image, audio, video", () => {
    expect(Object.keys(ALLOWED_UPLOAD_TYPES)).toEqual(
      expect.arrayContaining(["pdf", "image", "audio", "video"])
    );
  });
});

describe("detectUploadType", () => {
  // Extension-based detection
  describe("by extension", () => {
    it("detects pdf by .pdf", () => {
      expect(detectUploadType("document.pdf")).toBe("pdf");
    });

    it("detects image by .png", () => {
      expect(detectUploadType("photo.png")).toBe("image");
    });

    it("detects image by .jpg", () => {
      expect(detectUploadType("photo.jpg")).toBe("image");
    });

    it("detects image by .jpeg", () => {
      expect(detectUploadType("photo.jpeg")).toBe("image");
    });

    it("detects image by .gif", () => {
      expect(detectUploadType("anim.gif")).toBe("image");
    });

    it("detects image by .webp", () => {
      expect(detectUploadType("photo.webp")).toBe("image");
    });

    it("detects image by .svg", () => {
      expect(detectUploadType("icon.svg")).toBe("image");
    });

    it("detects audio by .mp3", () => {
      expect(detectUploadType("track.mp3")).toBe("audio");
    });

    it("detects audio by .m4a", () => {
      expect(detectUploadType("track.m4a")).toBe("audio");
    });

    it("detects audio by .wav", () => {
      expect(detectUploadType("track.wav")).toBe("audio");
    });

    it("detects audio by .flac", () => {
      expect(detectUploadType("track.flac")).toBe("audio");
    });

    it("detects audio by .aac", () => {
      expect(detectUploadType("track.aac")).toBe("audio");
    });

    it("detects audio by .ogg", () => {
      expect(detectUploadType("track.ogg")).toBe("audio");
    });

    it("detects audio by .opus", () => {
      expect(detectUploadType("track.opus")).toBe("audio");
    });

    it("detects video by .mp4", () => {
      expect(detectUploadType("clip.mp4")).toBe("video");
    });

    it("detects video by .mov", () => {
      expect(detectUploadType("clip.mov")).toBe("video");
    });

    it("detects video by .mkv", () => {
      expect(detectUploadType("clip.mkv")).toBe("video");
    });

    it("detects video by .webm", () => {
      expect(detectUploadType("clip.webm")).toBe("video");
    });

    it("is case-insensitive for extensions", () => {
      expect(detectUploadType("PHOTO.PNG")).toBe("image");
      expect(detectUploadType("TRACK.MP3")).toBe("audio");
    });
  });

  // MIME-based detection (fallback when extension is absent or unknown)
  describe("by MIME type", () => {
    it("detects pdf by application/pdf MIME", () => {
      expect(detectUploadType("file", "application/pdf")).toBe("pdf");
    });

    it("detects image by image/jpeg MIME", () => {
      expect(detectUploadType("file", "image/jpeg")).toBe("image");
    });

    it("detects audio by audio/mpeg MIME", () => {
      expect(detectUploadType("file", "audio/mpeg")).toBe("audio");
    });

    it("detects audio by audio/x-m4a (browser MIME variant)", () => {
      expect(detectUploadType("file", "audio/x-m4a")).toBe("audio");
    });

    it("detects audio by audio/mp4a-latm (browser MIME variant)", () => {
      expect(detectUploadType("file", "audio/mp4a-latm")).toBe("audio");
    });

    it("detects video by video/mp4 MIME", () => {
      expect(detectUploadType("file", "video/mp4")).toBe("video");
    });

    it("detects video by video/quicktime MIME", () => {
      expect(detectUploadType("file", "video/quicktime")).toBe("video");
    });
  });

  // Extension takes precedence over MIME
  describe("precedence", () => {
    it("prefers extension over MIME when both are provided", () => {
      // .mp3 extension but wrong MIME — extension should win
      expect(detectUploadType("track.mp3", "video/mp4")).toBe("audio");
    });

    it("falls back to MIME when extension is missing", () => {
      expect(detectUploadType("track", "audio/mpeg")).toBe("audio");
    });

    it("falls back to MIME when extension is unknown", () => {
      expect(detectUploadType("track.bin", "audio/flac")).toBe("audio");
    });
  });

  // Unsupported types
  describe("unsupported types", () => {
    it("returns null for unknown extension and no MIME", () => {
      expect(detectUploadType("file.xyz")).toBeNull();
    });

    it("returns null for unknown MIME when extension is unknown", () => {
      expect(detectUploadType("file.xyz", "application/octet-stream")).toBeNull();
    });

    it("returns null for no extension and no MIME", () => {
      expect(detectUploadType("file")).toBeNull();
    });

    it("returns null for wildcard-like MIME (not in allowlist)", () => {
      expect(detectUploadType("file", "audio/*")).toBeNull();
    });

    it("returns null for text/plain", () => {
      expect(detectUploadType("notes.txt")).toBeNull();
    });
  });
});
