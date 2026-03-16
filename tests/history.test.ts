import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HistoryStore, HistoryEntry } from "../src/history.js";
import { createHistoryStore, resolveHistoryPath } from "../src/history.js";
import { createHistoryStateFromConfig } from "../src/run/history-state.js";

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
    const path = resolveHistoryPath({
      env: { HOME: "/home/user" },
      historyPath: "~/custom/history.db",
    });
    expect(path).toBe("/home/user/custom/history.db");
  });

  it("returns null when HOME is missing", () => {
    const path = resolveHistoryPath({ env: {}, historyPath: null });
    expect(path).toBeNull();
  });

  it("respects absolute path", () => {
    const path = resolveHistoryPath({
      env: { HOME: "/home/user" },
      historyPath: "/tmp/my-history.db",
    });
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
      account: "test-user",
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
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: JSON.stringify({ costUsd: 0.004 }),
    };

    store.insert(entry);
    const result = store.getById("test-uuid-1", "test-user");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("test-uuid-1");
    expect(result!.title).toBe("Test Article");
    expect(result!.summary).toBe("# Test\n\nThis is a summary.");
    expect(result!.sourceUrl).toBe("https://example.com/article");
  });

  it("returns null for non-existent entry", () => {
    const result = store.getById("does-not-exist", "test-user");
    expect(result).toBeNull();
  });

  it("lists entries in reverse chronological order", () => {
    const base = new Date("2024-01-01T00:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      const ts = new Date(base.getTime() + i * 1000).toISOString();
      store.insert({
        id: `entry-${i}`,
        createdAt: ts,
        account: "test-user",
        sourceUrl: `https://example.com/${i}`,
        sourceType: "article",
        inputLength: "short",
        model: "anthropic/claude-sonnet-4",
        title: `Title ${i}`,
        summary: `Summary ${i}`,
        transcript: null,
        mediaPath: null,
        mediaSize: null,
        mediaType: null,
        audioPath: null,
        audioSize: null,
        audioType: null,
        metadata: null,
      });
    }

    const { entries, total } = store.list({ account: "test-user", limit: 3, offset: 0 });
    expect(total).toBe(5);
    expect(entries).toHaveLength(3);
    // Most recent first: entry-4, entry-3, entry-2
    expect(entries[0].id).toBe("entry-4");
    expect(entries[1].id).toBe("entry-3");
    expect(entries[2].id).toBe("entry-2");
  });

  it("paginates with offset", () => {
    const base = new Date("2024-01-01T00:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      const ts = new Date(base.getTime() + i * 1000).toISOString();
      store.insert({
        id: `entry-${i}`,
        createdAt: ts,
        account: "test-user",
        sourceUrl: `https://example.com/${i}`,
        sourceType: "article",
        inputLength: "short",
        model: "anthropic/claude-sonnet-4",
        title: `Title ${i}`,
        summary: `Summary ${i}`,
        transcript: null,
        mediaPath: null,
        mediaSize: null,
        mediaType: null,
        audioPath: null,
        audioSize: null,
        audioType: null,
        metadata: null,
      });
    }

    // Sorted desc: entry-4, entry-3, entry-2, entry-1, entry-0
    // offset=3, limit=2 → entry-1, entry-0
    const { entries, total } = store.list({ account: "test-user", limit: 2, offset: 3 });
    expect(total).toBe(5);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe("entry-1");
    expect(entries[1].id).toBe("entry-0");
  });

  it("deletes an entry and returns true", () => {
    store.insert({
      id: "to-delete",
      createdAt: new Date().toISOString(),
      account: "test-user",
      sourceUrl: null,
      sourceType: "text",
      inputLength: "short",
      model: "anthropic/claude-sonnet-4",
      title: "Delete me",
      summary: "Gone soon.",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: null,
    });

    const deleted = store.deleteById("to-delete", "test-user");
    expect(deleted).toBe(true);
    expect(store.getById("to-delete", "test-user")).toBeNull();
  });

  it("returns false when deleting non-existent entry", () => {
    const result = store.deleteById("ghost-id", "test-user");
    expect(result).toBe(false);
  });

  it("sets hasTranscript and hasMedia flags correctly", () => {
    store.insert({
      id: "flagged-entry",
      createdAt: new Date().toISOString(),
      account: "test-user",
      sourceUrl: "https://example.com/podcast",
      sourceType: "podcast",
      inputLength: "medium",
      model: "anthropic/claude-sonnet-4",
      title: "Podcast Episode",
      summary: "A podcast summary.",
      transcript: "This is the full transcript text.",
      mediaPath: "/tmp/media/episode.mp3",
      mediaSize: 1024,
      mediaType: "audio/mpeg",
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: null,
    });

    const { entries } = store.list({ account: "test-user", limit: 10, offset: 0 });
    expect(entries).toHaveLength(1);
    expect(entries[0].hasTranscript).toBe(true);
    expect(entries[0].hasMedia).toBe(true);
  });

  it("isolates entries by account", () => {
    store.insert({
      id: "alice-entry",
      createdAt: new Date().toISOString(),
      account: "alice",
      sourceUrl: "https://example.com/alice",
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: "Alice's Article",
      summary: "Alice's summary",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: null,
    });
    store.insert({
      id: "bob-entry",
      createdAt: new Date().toISOString(),
      account: "bob",
      sourceUrl: "https://example.com/bob",
      sourceType: "article",
      inputLength: "short",
      model: "test-model",
      title: "Bob's Article",
      summary: "Bob's summary",
      transcript: null,
      mediaPath: null,
      mediaSize: null,
      mediaType: null,
      audioPath: null,
      audioSize: null,
      audioType: null,
      metadata: null,
    });

    // Alice sees only her entry
    const aliceList = store.list({ account: "alice", limit: 10, offset: 0 });
    expect(aliceList.total).toBe(1);
    expect(aliceList.entries[0].id).toBe("alice-entry");

    // Bob sees only his entry
    const bobList = store.list({ account: "bob", limit: 10, offset: 0 });
    expect(bobList.total).toBe(1);
    expect(bobList.entries[0].id).toBe("bob-entry");

    // Alice can't get Bob's entry by ID
    expect(store.getById("bob-entry", "alice")).toBeNull();

    // Alice can't delete Bob's entry
    expect(store.deleteById("bob-entry", "alice")).toBe(false);

    // Bob's entry still exists
    expect(store.getById("bob-entry", "bob")).not.toBeNull();
  });
});

describe("createHistoryStateFromConfig", () => {
  it("returns store when enabled (default)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "history-config-test-"));
    try {
      const store = await createHistoryStateFromConfig({
        envForRun: { HOME: dir },
        config: null,
      });
      expect(store).not.toBeNull();
      store!.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when disabled via config", async () => {
    const store = await createHistoryStateFromConfig({
      envForRun: { HOME: "/tmp" },
      config: { history: { enabled: false } },
    });
    expect(store).toBeNull();
  });

  it("returns null when disabled via env var", async () => {
    const store = await createHistoryStateFromConfig({
      envForRun: { HOME: "/tmp", SUMMARIZE_HISTORY_ENABLED: "false" },
      config: null,
    });
    expect(store).toBeNull();
  });
});
