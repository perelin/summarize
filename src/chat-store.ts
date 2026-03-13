import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openSqlite } from "./sqlite.js";

export type ChatMessage = {
  id: string;
  summaryId: string;
  account: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  createdAt: string;
};

export type ChatStore = {
  insert: (msg: ChatMessage) => void;
  listBySummaryId: (summaryId: string, account: string) => ChatMessage[];
  close: () => void;
};

export async function createChatStore({ path }: { path: string }): Promise<ChatStore> {
  mkdirSync(dirname(path), { recursive: true });
  const db = await openSqlite(path);

  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec("PRAGMA busy_timeout=5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id          TEXT PRIMARY KEY,
      summary_id  TEXT NOT NULL,
      account     TEXT NOT NULL,
      role        TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content     TEXT NOT NULL,
      model       TEXT,
      created_at  TEXT NOT NULL
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_chat_summary_account ON chat_messages(summary_id, account, created_at ASC)",
  );

  const stmtInsert = db.prepare(`
    INSERT INTO chat_messages (id, summary_id, account, role, content, model, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const stmtList = db.prepare(
    "SELECT * FROM chat_messages WHERE summary_id = ? AND account = ? ORDER BY created_at ASC",
  );

  const mapRow = (row: Record<string, unknown>): ChatMessage => ({
    id: row.id as string,
    summaryId: row.summary_id as string,
    account: row.account as string,
    role: row.role as "user" | "assistant",
    content: row.content as string,
    model: (row.model as string) ?? null,
    createdAt: row.created_at as string,
  });

  const insert = (msg: ChatMessage): void => {
    stmtInsert.run(
      msg.id,
      msg.summaryId,
      msg.account,
      msg.role,
      msg.content,
      msg.model,
      msg.createdAt,
    );
  };

  const listBySummaryId = (summaryId: string, account: string): ChatMessage[] => {
    const rows = stmtList.all(summaryId, account) as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  };

  const close = (): void => {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      /* ignore */
    }
    db.close?.();
  };

  return { insert, listBySummaryId, close };
}
