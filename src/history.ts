import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { openSqlite } from "./sqlite.js";

export type HistoryEntry = {
  id: string;
  createdAt: string;
  sourceUrl: string | null;
  sourceType: string;
  inputLength: string;
  model: string;
  title: string | null;
  summary: string;
  transcript: string | null;
  mediaPath: string | null;
  mediaSize: number | null;
  mediaType: string | null;
  metadata: string | null;
};

export type HistoryListItem = Omit<HistoryEntry, "transcript"> & {
  hasTranscript: boolean;
  hasMedia: boolean;
};

export type HistoryStore = {
  insert: (entry: HistoryEntry) => void;
  getById: (id: string) => HistoryEntry | null;
  list: (opts: { limit: number; offset: number }) => { entries: HistoryListItem[]; total: number };
  deleteById: (id: string) => boolean;
  close: () => void;
};

export function resolveHistoryPath({
  env,
  historyPath,
}: {
  env: Record<string, string | undefined>;
  historyPath: string | null;
}): string | null {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || null;
  const raw = historyPath?.trim();
  if (raw && raw.length > 0) {
    if (raw.startsWith("~")) {
      if (!home) return null;
      const expanded = raw === "~" ? home : join(home, raw.slice(2));
      return resolvePath(expanded);
    }
    return isAbsolute(raw) ? raw : home ? resolvePath(join(home, raw)) : null;
  }
  if (!home) return null;
  return join(home, ".summarize", "history.sqlite");
}

export function resolveHistoryMediaPath({
  env,
  mediaPath,
}: {
  env: Record<string, string | undefined>;
  mediaPath: string | null;
}): string | null {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || null;
  const raw = mediaPath?.trim();
  if (raw && raw.length > 0) {
    if (raw.startsWith("~")) {
      if (!home) return null;
      const expanded = raw === "~" ? home : join(home, raw.slice(2));
      return resolvePath(expanded);
    }
    return isAbsolute(raw) ? raw : home ? resolvePath(join(home, raw)) : null;
  }
  if (!home) return null;
  return join(home, ".summarize", "history", "media");
}

export async function createHistoryStore({
  path,
}: {
  path: string;
}): Promise<HistoryStore> {
  mkdirSync(dirname(path), { recursive: true });
  const db = await openSqlite(path);

  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec("PRAGMA auto_vacuum=INCREMENTAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id            TEXT PRIMARY KEY,
      created_at    TEXT NOT NULL,
      source_url    TEXT,
      source_type   TEXT,
      input_length  TEXT NOT NULL,
      model         TEXT NOT NULL,
      title         TEXT,
      summary       TEXT NOT NULL,
      transcript    TEXT,
      media_path    TEXT,
      media_size    INTEGER,
      media_type    TEXT,
      metadata      TEXT
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC)");

  const stmtInsert = db.prepare(`
    INSERT INTO history (
      id, created_at, source_url, source_type, input_length, model,
      title, summary, transcript, media_path, media_size, media_type, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const stmtGetById = db.prepare("SELECT * FROM history WHERE id = ?");
  const stmtList = db.prepare("SELECT * FROM history ORDER BY created_at DESC LIMIT ? OFFSET ?");
  const stmtCount = db.prepare("SELECT COUNT(*) AS total FROM history");
  const stmtDelete = db.prepare("DELETE FROM history WHERE id = ?");

  const mapRow = (row: Record<string, unknown>): HistoryEntry => ({
    id: row.id as string,
    createdAt: row.created_at as string,
    sourceUrl: (row.source_url as string) ?? null,
    sourceType: (row.source_type as string) ?? "article",
    inputLength: row.input_length as string,
    model: row.model as string,
    title: (row.title as string) ?? null,
    summary: row.summary as string,
    transcript: (row.transcript as string) ?? null,
    mediaPath: (row.media_path as string) ?? null,
    mediaSize: (row.media_size as number) ?? null,
    mediaType: (row.media_type as string) ?? null,
    metadata: (row.metadata as string) ?? null,
  });

  const insert = (entry: HistoryEntry): void => {
    stmtInsert.run(
      entry.id, entry.createdAt, entry.sourceUrl, entry.sourceType,
      entry.inputLength, entry.model, entry.title, entry.summary,
      entry.transcript, entry.mediaPath, entry.mediaSize, entry.mediaType, entry.metadata,
    );
  };

  const getById = (id: string): HistoryEntry | null => {
    const row = stmtGetById.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return mapRow(row);
  };

  const list = (opts: { limit: number; offset: number }): { entries: HistoryListItem[]; total: number } => {
    const countRow = stmtCount.get() as { total?: number } | undefined;
    const total = typeof countRow?.total === "number" ? countRow.total : 0;
    const rows = stmtList.all(opts.limit, opts.offset) as Array<Record<string, unknown>>;
    const entries: HistoryListItem[] = rows.map((row) => {
      const entry = mapRow(row);
      const { transcript, ...rest } = entry;
      return {
        ...rest,
        hasTranscript: transcript != null && transcript.length > 0,
        hasMedia: entry.mediaPath != null && entry.mediaPath.length > 0,
      };
    });
    return { entries, total };
  };

  const deleteById = (id: string): boolean => {
    const result = stmtDelete.run(id) as { changes?: number };
    return typeof result?.changes === "number" ? result.changes > 0 : false;
  };

  const close = (): void => {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* ignore */ }
    db.close?.();
  };

  return { insert, getById, list, deleteById, close };
}
