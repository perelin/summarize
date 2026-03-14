import type { SseEvent } from "@steipete/summarize_p2-core/sse";

/** 15 minutes in milliseconds. */
const SESSION_TTL_MS = 15 * 60 * 1000;

/** 1 MB in bytes. */
const BUFFER_CAP_BYTES = 1024 * 1024;

/** How often the periodic cleanup runs (60 seconds). */
const CLEANUP_INTERVAL_MS = 60 * 1000;

export interface SseSession {
  id: string;
  events: Array<{ id: number; event: SseEvent }>;
  createdAt: number;
  totalBytes: number;
  completed: boolean;
}

/**
 * In-memory manager for SSE streaming sessions.
 *
 * Each session buffers events with sequential IDs so that clients can
 * reconnect via `Last-Event-ID` and resume from where they left off.
 *
 * Sessions expire after 15 minutes and are cleaned up periodically.
 * Event buffering stops (silently) once a session exceeds 1 MB.
 */
export type SseSubscriber = (event: SseEvent) => void;

export class SseSessionManager {
  private sessions = new Map<string, SseSession>();
  private subscribers = new Map<string, Set<SseSubscriber>>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  /** Create a new session and return its ID. Accepts an optional custom ID. */
  createSession(id?: string): string {
    const sessionId = id ?? crypto.randomUUID();
    const session: SseSession = {
      id: sessionId,
      events: [],
      createdAt: Date.now(),
      totalBytes: 0,
      completed: false,
    };
    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /** Push an event into a session's buffer. Silently no-ops if the session is missing or the buffer cap is exceeded. Notifies subscribers after buffering. */
  pushEvent(sessionId: string, event: SseEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Check if already over cap — stop buffering
    if (session.totalBytes < BUFFER_CAP_BYTES) {
      const eventBytes = JSON.stringify(event).length;
      session.events.push({ id: session.events.length + 1, event });
      session.totalBytes += eventBytes;
    }

    // Notify subscribers regardless of buffer cap
    const subs = this.subscribers.get(sessionId);
    if (subs) {
      for (const cb of subs) {
        cb(event);
      }
    }
  }

  /**
   * Get buffered events, optionally after a specific event ID
   * (for `Last-Event-ID` reconnection).
   *
   * Returns an empty array for unknown/expired sessions.
   */
  getEvents(sessionId: string, afterEventId?: number): Array<{ id: number; event: SseEvent }> {
    const session = this.getSession(sessionId);
    if (!session) return [];

    if (afterEventId === undefined || afterEventId === 0) {
      return [...session.events];
    }

    return session.events.filter((e) => e.id > afterEventId);
  }

  /** Destroy a session explicitly. Silently no-ops if the session doesn't exist. Removes subscribers. */
  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.subscribers.delete(sessionId);
  }

  /** Get a session by ID. Returns undefined if expired or missing. */
  getSession(sessionId: string): SseSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    if (this.isExpired(session)) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    return session;
  }

  /** Returns true if the session exists, is not expired, and is not completed. */
  isActive(sessionId: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;
    return !session.completed;
  }

  /** Mark a session as completed. Silently ignores unknown sessions. */
  markComplete(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.completed = true;
  }

  /**
   * Subscribe to new events for a session. Returns an unsubscribe function.
   * Throws if the session does not exist.
   */
  subscribe(sessionId: string, callback: SseSubscriber): () => void {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Cannot subscribe to unknown session: ${sessionId}`);
    }

    let subs = this.subscribers.get(sessionId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(sessionId, subs);
    }
    subs.add(callback);

    return () => {
      subs.delete(callback);
      if (subs.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  /** Stop the periodic cleanup interval. Call this when shutting down. */
  dispose(): void {
    clearInterval(this.cleanupTimer);
  }

  private isExpired(session: SseSession): boolean {
    return Date.now() - session.createdAt > SESSION_TTL_MS;
  }

  private cleanup(): void {
    for (const [id, session] of this.sessions) {
      if (this.isExpired(session)) {
        this.sessions.delete(id);
        this.subscribers.delete(id);
      }
    }
  }
}
