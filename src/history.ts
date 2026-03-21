import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { openSqlite } from "./sqlite.js";

export type HistoryEntry = {
  id: string;
  createdAt: string;
  account: string;
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
  audioPath: string | null;
  audioSize: number | null;
  audioType: string | null;
  metadata: string | null;
};

export type HistoryListItem = Omit<HistoryEntry, "transcript"> & {
  hasTranscript: boolean;
  hasMedia: boolean;
  hasAudio: boolean;
};

export type HistoryStore = {
  insert: (entry: HistoryEntry) => void;
  getById: (id: string, account: string) => HistoryEntry | null;
  list: (opts: { account: string; limit: number; offset: number }) => {
    entries: HistoryListItem[];
    total: number;
  };
  deleteById: (id: string, account: string) => boolean;
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
    return isAbsolute(raw) ? raw : resolvePath(raw);
  }
  const dataDir = env.SUMMARIZE_DATA_DIR?.trim();
  if (!dataDir) return null;
  return join(dataDir, "history.sqlite");
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
    return isAbsolute(raw) ? raw : resolvePath(raw);
  }
  const dataDir = env.SUMMARIZE_DATA_DIR?.trim();
  if (!dataDir) return null;
  return join(dataDir, "history", "media");
}

export async function createHistoryStore({ path }: { path: string }): Promise<HistoryStore> {
  mkdirSync(dirname(path), { recursive: true });
  const db = await openSqlite(path);

  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec("PRAGMA auto_vacuum=INCREMENTAL");

  // Check if existing table needs migration (lacks account column)
  const tableInfo = db.prepare("PRAGMA table_info(history)").all() as Array<{ name: string }>;
  const hasTable = tableInfo.length > 0;
  const hasAccountCol = tableInfo.some((col) => col.name === "account");
  if (hasTable && !hasAccountCol) {
    console.warn(
      "[summarize-api] history: dropping legacy history table (no account column) — starting fresh",
    );
    db.exec("DROP TABLE history");
    db.exec("DROP INDEX IF EXISTS idx_history_created");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id            TEXT PRIMARY KEY,
      created_at    TEXT NOT NULL,
      account       TEXT NOT NULL,
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
      audio_path    TEXT,
      audio_size    INTEGER,
      audio_type    TEXT,
      metadata      TEXT
    )
  `);

  // Migrate: add audio columns if missing (for existing databases)
  const colInfo = db.prepare("PRAGMA table_info(history)").all() as Array<{ name: string }>;
  if (!colInfo.some((col) => col.name === "audio_path")) {
    db.exec("ALTER TABLE history ADD COLUMN audio_path TEXT");
    db.exec("ALTER TABLE history ADD COLUMN audio_size INTEGER");
    db.exec("ALTER TABLE history ADD COLUMN audio_type TEXT");
  }
  db.exec("DROP INDEX IF EXISTS idx_history_created");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_history_account_created ON history(account, created_at DESC)",
  );

  const stmtInsert = db.prepare(`
    INSERT INTO history (
      id, created_at, account, source_url, source_type, input_length, model,
      title, summary, transcript, media_path, media_size, media_type,
      audio_path, audio_size, audio_type, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const stmtGetById = db.prepare("SELECT * FROM history WHERE id = ? AND account = ?");
  const stmtList = db.prepare(
    "SELECT * FROM history WHERE account = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
  );
  const stmtCount = db.prepare("SELECT COUNT(*) AS total FROM history WHERE account = ?");
  const stmtDelete = db.prepare("DELETE FROM history WHERE id = ? AND account = ?");

  const mapRow = (row: Record<string, unknown>): HistoryEntry => ({
    id: row.id as string,
    createdAt: row.created_at as string,
    account: row.account as string,
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
    audioPath: (row.audio_path as string) ?? null,
    audioSize: (row.audio_size as number) ?? null,
    audioType: (row.audio_type as string) ?? null,
    metadata: (row.metadata as string) ?? null,
  });

  const insert = (entry: HistoryEntry): void => {
    stmtInsert.run(
      entry.id,
      entry.createdAt,
      entry.account,
      entry.sourceUrl,
      entry.sourceType,
      entry.inputLength,
      entry.model,
      entry.title,
      entry.summary,
      entry.transcript,
      entry.mediaPath,
      entry.mediaSize,
      entry.mediaType,
      entry.audioPath,
      entry.audioSize,
      entry.audioType,
      entry.metadata,
    );
  };

  const getById = (id: string, account: string): HistoryEntry | null => {
    const row = stmtGetById.get(id, account) as Record<string, unknown> | undefined;
    if (!row) return null;
    return mapRow(row);
  };

  const list = (opts: {
    account: string;
    limit: number;
    offset: number;
  }): { entries: HistoryListItem[]; total: number } => {
    const countRow = stmtCount.get(opts.account) as { total?: number } | undefined;
    const total = typeof countRow?.total === "number" ? countRow.total : 0;
    const rows = stmtList.all(opts.account, opts.limit, opts.offset) as Array<
      Record<string, unknown>
    >;
    const entries: HistoryListItem[] = rows.map((row) => {
      const entry = mapRow(row);
      const { transcript, ...rest } = entry;
      return {
        ...rest,
        hasTranscript: transcript != null && transcript.length > 0,
        hasMedia: entry.mediaPath != null && entry.mediaPath.length > 0,
        hasAudio: entry.audioPath != null && entry.audioPath.length > 0,
      };
    });
    return { entries, total };
  };

  const deleteById = (id: string, account: string): boolean => {
    const result = stmtDelete.run(id, account) as { changes?: number };
    return typeof result?.changes === "number" ? result.changes > 0 : false;
  };

  const close = (): void => {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      /* ignore */
    }
    db.close?.();
  };

  return { insert, getById, list, deleteById, close };
}
