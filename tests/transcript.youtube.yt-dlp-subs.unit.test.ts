import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchSubtitlesWithYtDlp } from "../src/core/content/transcript/providers/youtube/yt-dlp-subs.js";

const VIDEO_URL = "https://www.youtube.com/watch?v=-RXD4bTuFTo";

describe("fetchSubtitlesWithYtDlp", () => {
  it("prefers the English track and parses json3 into transcript text", async () => {
    const { ytDlpPath, cleanup } = await createFakeYtDlp();
    try {
      const result = await fetchSubtitlesWithYtDlp({ ytDlpPath, url: VIDEO_URL });
      expect(result.kind).toBe("manual");
      expect(result.payload?.text).toBe("first line\nsecond line");
      expect(result.payload?.segments?.[0]).toMatchObject({ startMs: 0, text: "first line" });
    } finally {
      await cleanup();
    }
  });

  it("returns no payload without a yt-dlp binary", async () => {
    const result = await fetchSubtitlesWithYtDlp({ ytDlpPath: null, url: VIDEO_URL });
    expect(result.payload).toBeNull();
    expect(result.error).toBeNull();
  });
});

/**
 * Stand-in for the real binary: writes the json3 files yt-dlp would write, including a
 * decoy non-English track, so the ranking in readBestSubtitleFile is actually exercised.
 */
async function createFakeYtDlp(): Promise<{ ytDlpPath: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(join(tmpdir(), "fake-yt-dlp-"));
  const ytDlpPath = join(dir, "yt-dlp");
  const english = JSON.stringify({
    events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "first line" }] },
      { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: "second " }, { utf8: "line" }] },
    ],
  });
  const german = JSON.stringify({
    events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "erste Zeile" }] }],
  });

  await fs.writeFile(
    ytDlpPath,
    `#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; out="$1"; fi
  shift
done
printf '%s' '${german}' > "$out.de.json3"
printf '%s' '${english}' > "$out.en.json3"
`,
    { mode: 0o755 },
  );

  return {
    ytDlpPath,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}
