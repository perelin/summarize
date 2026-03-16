import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ---------------------------------------------------------------------------
// Environment guard — same pattern as tests/live/*.live.test.ts
// ---------------------------------------------------------------------------
const E2E = process.env.SUMMARIZE_E2E === "1";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------
type E2EEntry = {
  type: string;
  mode: "url" | "text" | "upload";
  url?: string;
  text?: string;
  downloadUrl?: string;
  filePath?: string;
  filename?: string;
  mimeType?: string;
  keywords: string[];
  description: string;
  insightChecks?: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Read test config
// ---------------------------------------------------------------------------
const entries: E2EEntry[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "e2e.config.json"), "utf8"),
);

// ---------------------------------------------------------------------------
// Resolve auth token from config.json (same search order as the server)
// ---------------------------------------------------------------------------
function resolveAuthToken(): string {
  const searchPaths = [
    join(process.cwd(), "config.json"),
    join(process.env.HOME ?? "", ".summarize", "config.json"),
  ];

  for (const p of searchPaths) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      if (Array.isArray(raw.accounts) && raw.accounts.length > 0) {
        return raw.accounts[0].token as string;
      }
    } catch {
      // not found, try next
    }
  }

  throw new Error(
    "E2E: No config.json with accounts found. Searched:\n" +
      searchPaths.map((p) => `  - ${p}`).join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PORT = 9876;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_TIMEOUT = 120_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function summarizeUrl(
  url: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/v1/summarize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url, length: "short" }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function summarizeText(
  text: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/v1/summarize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text, length: "short" }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function summarizeUploadFromUrl(
  downloadUrl: string,
  filename: string,
  mimeType: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) {
    throw new Error(`Failed to download file from ${downloadUrl}: ${fileRes.status}`);
  }
  const blob = await fileRes.blob();
  return uploadBlob(new Blob([blob]), filename, mimeType, token);
}

async function summarizeUploadFromDisk(
  filePath: string,
  filename: string,
  mimeType: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const absPath = filePath.startsWith("/") ? filePath : join(process.cwd(), filePath);
  const bytes = readFileSync(absPath);
  return uploadBlob(new Blob([bytes]), filename, mimeType, token);
}

async function uploadBlob(
  blob: Blob,
  filename: string,
  mimeType: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.append("file", new File([blob], filename, { type: mimeType }));
  form.append("length", "short");

  const res = await fetch(`${BASE}/v1/summarize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  return { status: res.status, body };
}

function assertResponseStructure(body: Record<string, unknown>): void {
  expect(body).toHaveProperty("summaryId");
  expect(body).toHaveProperty("summary");
  expect(body).toHaveProperty("metadata");
  expect(body).toHaveProperty("insights");
  expect(typeof body.summaryId).toBe("string");
  expect(typeof body.summary).toBe("string");
  expect((body.summary as string).length).toBeGreaterThan(0);
}

function assertKeywords(summary: string, keywords: string[]): void {
  const lower = summary.toLowerCase();
  for (const kw of keywords) {
    expect(lower, `Summary should contain keyword "${kw}"`).toContain(kw.toLowerCase());
  }
}

function assertInsightChecks(
  insights: Record<string, unknown> | null,
  checks: Record<string, string>,
): void {
  expect(insights).not.toBeNull();
  for (const [field, assertion] of Object.entries(checks)) {
    if (assertion === "non-null") {
      expect(
        (insights as Record<string, unknown>)[field],
        `insights.${field} should be non-null`,
      ).not.toBeNull();
    }
  }
}

function resolveYtDlpPath(): string | null {
  try {
    return execFileSync("which", ["yt-dlp"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function isEntryEnabled(entry: E2EEntry): boolean {
  if (entry.mode === "url") return !!entry.url;
  if (entry.mode === "text") return !!entry.text;
  if (entry.mode === "upload") return !!(entry.filePath || entry.downloadUrl);
  return false;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
(E2E ? describe : describe.skip)("e2e: critical path", () => {
  let serverProc: ChildProcess | null = null;
  let authToken: string;

  beforeAll(async () => {
    authToken = resolveAuthToken();

    // Spawn the real server
    const serverEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      SUMMARIZE_API_PORT: String(PORT),
    };
    const ytDlp = resolveYtDlpPath();
    if (ytDlp) serverEnv.YT_DLP_PATH = ytDlp;

    serverProc = spawn("npx", ["tsx", "--env-file-if-exists=.env", "src/server/main.ts"], {
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
    });

    // Wait for the "Listening on" line
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("E2E: Server did not start within 30s"));
      }, 30_000);

      function onData(chunk: Buffer) {
        const text = chunk.toString();
        if (text.includes(`Listening on http://0.0.0.0:${PORT}`)) {
          clearTimeout(timeout);
          resolve();
        }
      }

      serverProc!.stdout!.on("data", onData);
      serverProc!.stderr!.on("data", onData);

      serverProc!.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`E2E: Server failed to spawn: ${err.message}`));
      });

      serverProc!.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`E2E: Server exited early with code ${code}`));
      });
    });
  }, 60_000);

  afterAll(async () => {
    if (!serverProc) return;

    serverProc.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        serverProc?.kill("SIGKILL");
        resolve();
      }, 5_000);

      serverProc!.on("exit", () => {
        clearTimeout(forceKill);
        resolve();
      });
    });
  });

  // ---- Media-type tests (concurrent) ------------------------------------
  describe.concurrent("media types", () => {
    for (const entry of entries) {
      const testFn = isEntryEnabled(entry) ? it : it.skip;

      testFn(
        entry.description,
        async () => {
          let result: { status: number; body: Record<string, unknown> };

          if (entry.mode === "url") {
            result = await summarizeUrl(entry.url!, authToken);
          } else if (entry.mode === "text") {
            result = await summarizeText(entry.text!, authToken);
          } else if (entry.filePath) {
            result = await summarizeUploadFromDisk(
              entry.filePath,
              entry.filename!,
              entry.mimeType!,
              authToken,
            );
          } else {
            result = await summarizeUploadFromUrl(
              entry.downloadUrl!,
              entry.filename!,
              entry.mimeType!,
              authToken,
            );
          }

          expect(
            result.status,
            `Expected 200 but got ${result.status}: ${JSON.stringify(result.body)}`,
          ).toBe(200);
          assertResponseStructure(result.body);
          assertKeywords(result.body.summary as string, entry.keywords);

          if (entry.insightChecks) {
            assertInsightChecks(
              result.body.insights as Record<string, unknown> | null,
              entry.insightChecks,
            );
          }
        },
        TEST_TIMEOUT,
      );
    }
  });
});
