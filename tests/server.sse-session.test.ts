import type { SseEvent } from "@steipete/summarize_p2-core/sse";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SseSessionManager } from "../src/server/sse-session.js";

describe("SseSessionManager", () => {
  let manager: SseSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new SseSessionManager();
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  it("creates a session and returns an ID", () => {
    const id = manager.createSession();
    expect(id).toBeTypeOf("string");
    expect(id.length).toBeGreaterThan(0);

    const session = manager.getSession(id);
    expect(session).toBeDefined();
    expect(session!.id).toBe(id);
    expect(session!.events).toEqual([]);
    expect(session!.totalBytes).toBe(0);
  });

  it("creates unique session IDs", () => {
    const id1 = manager.createSession();
    const id2 = manager.createSession();
    expect(id1).not.toBe(id2);
  });

  it("buffers events and retrieves them", () => {
    const id = manager.createSession();

    const evt1: SseEvent = { event: "status", data: { text: "Working..." } };
    const evt2: SseEvent = { event: "chunk", data: { text: "Hello" } };

    manager.pushEvent(id, evt1);
    manager.pushEvent(id, evt2);

    const events = manager.getEvents(id);
    expect(events).toHaveLength(2);
    expect(events[0]!.id).toBe(1);
    expect(events[0]!.event).toEqual(evt1);
    expect(events[1]!.id).toBe(2);
    expect(events[1]!.event).toEqual(evt2);
  });

  it("assigns sequential event IDs starting at 1", () => {
    const id = manager.createSession();

    for (let i = 0; i < 5; i++) {
      manager.pushEvent(id, { event: "chunk", data: { text: `part ${i}` } });
    }

    const events = manager.getEvents(id);
    expect(events.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("supports Last-Event-ID reconnection", () => {
    const id = manager.createSession();

    manager.pushEvent(id, { event: "status", data: { text: "step 1" } });
    manager.pushEvent(id, { event: "chunk", data: { text: "chunk 1" } });
    manager.pushEvent(id, { event: "chunk", data: { text: "chunk 2" } });
    manager.pushEvent(id, { event: "chunk", data: { text: "chunk 3" } });

    // Get events after event ID 2 (should return events 3 and 4)
    const events = manager.getEvents(id, 2);
    expect(events).toHaveLength(2);
    expect(events[0]!.id).toBe(3);
    expect(events[0]!.event).toEqual({ event: "chunk", data: { text: "chunk 2" } });
    expect(events[1]!.id).toBe(4);
    expect(events[1]!.event).toEqual({ event: "chunk", data: { text: "chunk 3" } });
  });

  it("returns all events when afterEventId is 0", () => {
    const id = manager.createSession();

    manager.pushEvent(id, { event: "status", data: { text: "hi" } });
    manager.pushEvent(id, { event: "chunk", data: { text: "world" } });

    const events = manager.getEvents(id, 0);
    expect(events).toHaveLength(2);
  });

  it("returns empty array when afterEventId is past the last event", () => {
    const id = manager.createSession();

    manager.pushEvent(id, { event: "status", data: { text: "hi" } });

    const events = manager.getEvents(id, 99);
    expect(events).toHaveLength(0);
  });

  it("returns empty array for unknown session ID in getEvents", () => {
    const events = manager.getEvents("nonexistent");
    expect(events).toEqual([]);
  });

  it("enforces 1MB buffer cap", () => {
    const id = manager.createSession();

    // Each chunk event: {"event":"chunk","data":{"text":"<1000 chars>"}}
    // JSON.stringify of SseEvent data is roughly 1020+ bytes per event
    const largeText = "x".repeat(1000);
    const singleEventBytes = JSON.stringify({ event: "chunk", data: { text: largeText } }).length;

    // Push events until we exceed 1MB
    const eventsNeeded = Math.ceil((1024 * 1024) / singleEventBytes) + 10;
    for (let i = 0; i < eventsNeeded; i++) {
      manager.pushEvent(id, { event: "chunk", data: { text: largeText } });
    }

    const session = manager.getSession(id);
    expect(session).toBeDefined();
    // totalBytes should not significantly exceed 1MB (the last event that crossed
    // the threshold is still added, but subsequent ones are dropped)
    expect(session!.totalBytes).toBeLessThanOrEqual(1024 * 1024 + singleEventBytes);

    // The events buffered should be fewer than eventsNeeded
    expect(session!.events.length).toBeLessThan(eventsNeeded);
  });

  it("stops buffering but does not error when buffer cap is exceeded", () => {
    const id = manager.createSession();

    const largeText = "y".repeat(10_000);

    // Push many events — should never throw
    for (let i = 0; i < 200; i++) {
      expect(() => {
        manager.pushEvent(id, { event: "chunk", data: { text: largeText } });
      }).not.toThrow();
    }

    const session = manager.getSession(id);
    expect(session).toBeDefined();
    // Should have stopped buffering at some point
    expect(session!.events.length).toBeLessThan(200);
  });

  it("silently ignores pushEvent for unknown session", () => {
    expect(() => {
      manager.pushEvent("nonexistent", { event: "status", data: { text: "hi" } });
    }).not.toThrow();
  });

  it("expires sessions after TTL", () => {
    const id = manager.createSession();

    manager.pushEvent(id, { event: "status", data: { text: "hello" } });

    // Session should exist initially
    expect(manager.getSession(id)).toBeDefined();

    // Advance time past the 15-minute TTL
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    // Session should be expired
    expect(manager.getSession(id)).toBeUndefined();
    expect(manager.getEvents(id)).toEqual([]);
  });

  it("does not expire sessions before TTL", () => {
    const id = manager.createSession();

    manager.pushEvent(id, { event: "status", data: { text: "hello" } });

    // Advance time to just before the 15-minute TTL
    vi.advanceTimersByTime(15 * 60 * 1000 - 1000);

    // Session should still exist
    expect(manager.getSession(id)).toBeDefined();
    expect(manager.getEvents(id)).toHaveLength(1);
  });

  it("cleans up expired sessions via periodic cleanup", () => {
    const id1 = manager.createSession();
    manager.pushEvent(id1, { event: "status", data: { text: "old" } });

    // Advance time past TTL
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    // Create a new session after the old one expired
    const id2 = manager.createSession();
    manager.pushEvent(id2, { event: "status", data: { text: "new" } });

    // Trigger the cleanup interval (runs every 60 seconds)
    vi.advanceTimersByTime(60 * 1000);

    // Old session should be gone, new session should remain
    expect(manager.getSession(id1)).toBeUndefined();
    expect(manager.getSession(id2)).toBeDefined();
  });

  it("destroys sessions explicitly", () => {
    const id = manager.createSession();
    manager.pushEvent(id, { event: "status", data: { text: "hi" } });

    expect(manager.getSession(id)).toBeDefined();

    manager.destroySession(id);

    expect(manager.getSession(id)).toBeUndefined();
    expect(manager.getEvents(id)).toEqual([]);
  });

  it("silently ignores destroying a nonexistent session", () => {
    expect(() => {
      manager.destroySession("nonexistent");
    }).not.toThrow();
  });

  it("dispose stops the cleanup interval", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    const mgr = new SseSessionManager();
    mgr.dispose();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("tracks totalBytes accurately", () => {
    const id = manager.createSession();

    const evt1: SseEvent = { event: "status", data: { text: "hi" } };
    const evt2: SseEvent = { event: "chunk", data: { text: "world" } };

    manager.pushEvent(id, evt1);
    manager.pushEvent(id, evt2);

    const session = manager.getSession(id);
    const expectedBytes = JSON.stringify(evt1).length + JSON.stringify(evt2).length;
    expect(session!.totalBytes).toBe(expectedBytes);
  });

  // ---- Custom ID tests ----

  it("accepts a custom session ID", () => {
    const customId = "my-custom-id-123";
    const id = manager.createSession(customId);
    expect(id).toBe(customId);
    const session = manager.getSession(id);
    expect(session).toBeDefined();
    expect(session!.id).toBe(customId);
  });

  it("still generates an ID when none is provided", () => {
    const id = manager.createSession();
    expect(id).toBeTypeOf("string");
    expect(id.length).toBeGreaterThan(0);
  });

  // ---- isActive / markComplete tests ----

  it("isActive returns true for a new session", () => {
    const id = manager.createSession();
    expect(manager.isActive(id)).toBe(true);
  });

  it("isActive returns false after markComplete", () => {
    const id = manager.createSession();
    manager.pushEvent(id, { event: "chunk", data: { text: "hello" } });
    manager.markComplete(id);
    expect(manager.isActive(id)).toBe(false);
  });

  it("isActive returns false for unknown session", () => {
    expect(manager.isActive("nonexistent")).toBe(false);
  });

  it("isActive returns false for expired session", () => {
    const id = manager.createSession();
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(manager.isActive(id)).toBe(false);
  });

  it("markComplete silently ignores unknown session", () => {
    expect(() => manager.markComplete("nonexistent")).not.toThrow();
  });

  // ---- subscribe tests ----

  it("subscribe receives new events pushed after subscription", () => {
    const id = manager.createSession();
    manager.pushEvent(id, { event: "status", data: { text: "before" } });
    const received: SseEvent[] = [];
    manager.subscribe(id, (event) => received.push(event));
    manager.pushEvent(id, { event: "chunk", data: { text: "after1" } });
    manager.pushEvent(id, { event: "chunk", data: { text: "after2" } });
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({ event: "chunk", data: { text: "after1" } });
    expect(received[1]).toEqual({ event: "chunk", data: { text: "after2" } });
  });

  it("subscribe returns an unsubscribe function", () => {
    const id = manager.createSession();
    const received: SseEvent[] = [];
    const unsub = manager.subscribe(id, (event) => received.push(event));
    manager.pushEvent(id, { event: "chunk", data: { text: "first" } });
    unsub();
    manager.pushEvent(id, { event: "chunk", data: { text: "second" } });
    expect(received).toHaveLength(1);
  });

  it("subscribe throws for unknown session", () => {
    expect(() => manager.subscribe("nonexistent", () => {})).toThrow();
  });

  it("multiple subscribers receive the same events", () => {
    const id = manager.createSession();
    const received1: SseEvent[] = [];
    const received2: SseEvent[] = [];
    manager.subscribe(id, (event) => received1.push(event));
    manager.subscribe(id, (event) => received2.push(event));
    manager.pushEvent(id, { event: "chunk", data: { text: "shared" } });
    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it("cleanup removes subscribers for expired sessions", () => {
    const id = manager.createSession();
    const received: SseEvent[] = [];
    manager.subscribe(id, (event) => received.push(event));
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    vi.advanceTimersByTime(60 * 1000);
    manager.pushEvent(id, { event: "chunk", data: { text: "late" } });
    expect(received).toHaveLength(0);
  });
});
