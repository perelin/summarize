import { describe, expect, it } from "vitest";
import { mergeStreamingChunk } from "../src/shared/streaming-merge.js";

describe("mergeStreamingChunk", () => {
  it("returns previous unchanged when chunk is empty", () => {
    const result = mergeStreamingChunk("hello", "");
    expect(result).toEqual({ next: "hello", appended: "" });
  });

  it("returns chunk when previous is empty", () => {
    const result = mergeStreamingChunk("", "hello");
    expect(result).toEqual({ next: "hello", appended: "hello" });
  });

  it("handles chunk that extends previous (prefix match)", () => {
    const result = mergeStreamingChunk("hello", "hello world");
    expect(result).toEqual({ next: "hello world", appended: " world" });
  });

  it("keeps previous when chunk is a subset of it", () => {
    const result = mergeStreamingChunk("hello world", "hello");
    expect(result).toEqual({ next: "hello world", appended: "" });
  });

  it("concatenates when no overlap exists", () => {
    const result = mergeStreamingChunk("aaa", "zzz");
    expect(result).toEqual({ next: "aaazzz", appended: "zzz" });
  });

  it("detects suffix/prefix overlap and stitches", () => {
    // previous ends with "world" and chunk starts with "world"
    const result = mergeStreamingChunk("hello world", "world!");
    expect(result).toEqual({ next: "hello world!", appended: "!" });
  });

  it("normalizes \\r\\n to \\n", () => {
    const result = mergeStreamingChunk("line1\r\n", "line1\nline2");
    expect(result).toEqual({ next: "line1\nline2", appended: "line2" });
  });

  it("handles identical previous and chunk", () => {
    const result = mergeStreamingChunk("same", "same");
    expect(result).toEqual({ next: "same", appended: "" });
  });

  it("handles large prefix overlap heuristic", () => {
    // When chunk is longer and shares a long prefix with previous
    const prev = "A".repeat(100);
    const chunk = "A".repeat(95) + "BBBBB" + "CCCCC";
    const result = mergeStreamingChunk(prev, chunk);
    // Should use prefix heuristic since 95/100 >= 90%
    expect(result.next).toBe(chunk);
    expect(result.appended).toBe("BBBBB" + "CCCCC");
  });

  it("handles both empty", () => {
    const result = mergeStreamingChunk("", "");
    expect(result).toEqual({ next: "", appended: "" });
  });
});
