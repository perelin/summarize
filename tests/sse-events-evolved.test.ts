import { encodeSseEvent, parseSseEvent } from "@steipete/summarize_p2-core/sse";
import { describe, expect, it } from "vitest";

describe("SSE events - evolved schema", () => {
  it("encodes done event with summaryId", () => {
    const encoded = encodeSseEvent({ event: "done", data: { summaryId: "abc-123" } });
    expect(encoded).toContain("event: done");
    expect(encoded).toContain('"summaryId":"abc-123"');
  });

  it("round-trips done event with summaryId", () => {
    const original = { event: "done" as const, data: { summaryId: "sum-456" } };
    const encoded = encodeSseEvent(original);
    const parsed = parseSseEvent({ event: "done", data: JSON.stringify(original.data) });
    expect(parsed).toEqual(original);
  });

  it("encodes error event with code", () => {
    const encoded = encodeSseEvent({
      event: "error",
      data: { code: "TIMEOUT", message: "Request timed out" },
    });
    expect(encoded).toContain('"code":"TIMEOUT"');
  });

  it("encodes error event without code (backward compat)", () => {
    const encoded = encodeSseEvent({ event: "error", data: { message: "Something failed" } });
    expect(encoded).toContain('"message":"Something failed"');
    expect(encoded).not.toContain('"code"');
  });

  it("round-trips error event with code", () => {
    const original = {
      event: "error" as const,
      data: { code: "RATE_LIMIT", message: "Too many requests" },
    };
    const encoded = encodeSseEvent(original);
    const parsed = parseSseEvent({ event: "error", data: JSON.stringify(original.data) });
    expect(parsed).toEqual(original);
  });

  it("meta event already works (existing schema)", () => {
    const encoded = encodeSseEvent({
      event: "meta",
      data: { model: "gpt-4", modelLabel: "GPT-4", inputSummary: "Test", summaryFromCache: false },
    });
    expect(encoded).toContain("event: meta");
  });
});
