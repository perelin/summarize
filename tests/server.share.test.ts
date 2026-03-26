import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHistoryStore, type HistoryEntry, type HistoryStore } from "../src/history.js";

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: "entry-1",
  createdAt: "2026-03-26T10:00:00Z",
  account: "test-user",
  sourceUrl: "https://example.com/article",
  sourceType: "article",
  inputLength: "short",
  model: "test-model",
  title: "Test Article",
  summary: "A summary of the article.",
  transcript: null,
  mediaPath: null,
  mediaSize: null,
  mediaType: null,
  audioPath: null,
  audioSize: null,
  audioType: null,
  metadata: null,
  ...overrides,
});

describe("History share token operations", () => {
  let tmpDir: string;
  let store: HistoryStore;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "share-test-"));
    store = await createHistoryStore({ path: join(tmpDir, "history.sqlite") });
    store.insert(makeEntry());
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("setShareToken stores a token and getByShareToken retrieves the entry", () => {
    const result = store.setShareToken("entry-1", "test-user", "tok_abc123");
    expect(result).toBe(true);

    const entry = store.getByShareToken("tok_abc123");
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("entry-1");
    expect(entry!.summary).toBe("A summary of the article.");
  });

  it("getByShareToken returns null for unknown token", () => {
    const entry = store.getByShareToken("nonexistent-token");
    expect(entry).toBeNull();
  });

  it("clearShareToken removes the token", () => {
    store.setShareToken("entry-1", "test-user", "tok_abc123");
    const cleared = store.clearShareToken("entry-1", "test-user");
    expect(cleared).toBe(true);

    const entry = store.getByShareToken("tok_abc123");
    expect(entry).toBeNull();
  });

  it("clearShareToken returns false for entry without token", () => {
    const cleared = store.clearShareToken("entry-1", "test-user");
    expect(cleared).toBe(false);
  });

  it("getShareToken returns token for shared entry", () => {
    store.setShareToken("entry-1", "test-user", "tok_abc123");
    const token = store.getShareToken("entry-1", "test-user");
    expect(token).toBe("tok_abc123");
  });

  it("getShareToken returns null for non-shared entry", () => {
    const token = store.getShareToken("entry-1", "test-user");
    expect(token).toBeNull();
  });

  it("setShareToken is idempotent (second call returns false, keeps existing)", () => {
    const first = store.setShareToken("entry-1", "test-user", "tok_first");
    expect(first).toBe(true);

    const second = store.setShareToken("entry-1", "test-user", "tok_second");
    expect(second).toBe(false);

    // Original token is preserved
    const token = store.getShareToken("entry-1", "test-user");
    expect(token).toBe("tok_first");
  });

  it("setShareToken fails for wrong account", () => {
    const result = store.setShareToken("entry-1", "other-user", "tok_abc123");
    expect(result).toBe(false);

    const entry = store.getByShareToken("tok_abc123");
    expect(entry).toBeNull();
  });
});
