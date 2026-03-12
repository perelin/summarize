import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HistoryStore, HistoryEntry } from "../src/history.js";
import { createHistoryStore, resolveHistoryPath } from "../src/history.js";

describe("history config types", () => {
  it("SummarizeConfig accepts history section", async () => {
    const config: import("../src/config/types.js").SummarizeConfig = {
      history: {
        enabled: true,
        path: "~/.summarize/history.sqlite",
        mediaPath: "~/.summarize/history/media/",
      },
    };
    expect(config.history?.enabled).toBe(true);
  });
});

describe("resolveHistoryPath", () => {
  it("returns default path when no override", () => {
    const path = resolveHistoryPath({ env: { HOME: "/home/user" }, historyPath: null });
    expect(path).toBe("/home/user/.summarize/history.sqlite");
  });

  it("expands ~ in custom path", () => {
    const path = resolveHistoryPath({ env: { HOME: "/home/user" }, historyPath: "~/custom/history.db" });
    expect(path).toBe("/home/user/custom/history.db");
  });

  it("returns null when HOME is missing", () => {
    const path = resolveHistoryPath({ env: {}, historyPath: null });
    expect(path).toBeNull();
  });

  it("respects absolute path", () => {
    const path = resolveHistoryPath({ env: { HOME: "/home/user" }, historyPath: "/tmp/my-history.db" });
    expect(path).toBe("/tmp/my-history.db");
  });
});

describe("HistoryStore", () => {
  let tmpDir: string;
  let store: HistoryStore;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "history-test-"));
    store = await createHistoryStore({ path: join(tmpDir, "history.sqlite") });
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("inserts and retrieves a history entry", () => {
    const entry: HistoryEntry = {
      id: "test-uuid-1",
      createdAt: new Date().toISOString(),
      sourceUrl: "https://example.com/article",
      sourceType: "article",
      inputLength: "short",
      model: "anthropic/claude-sonnet-4",
      title: "Test Article",
      summary: "# Test\n\nThis is a summary.",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      metadata: JSON.stringify({ costUsd: 0.004 }),
    };

    store.insert(entry);
    const result = store.getById("test-uuid-1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("test-uuid-1");
    expect(result!.title).toBe("Test Article");
    expect(result!.summary).toBe("# Test\n\nThis is a summary.");
    expect(result!.sourceUrl).toBe("https://example.com/article");
  });

  it("returns null for non-existent entry", () => {
    const result = store.getById("does-not-exist");
    expect(result).toBeNull();
  });
});
