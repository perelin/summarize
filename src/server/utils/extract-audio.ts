import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Extract audio track from a video file as a 128kbps MP3.
 * Returns file size on success, null if ffmpeg is unavailable or extraction fails.
 */
export async function extractAudioFromVideo(
  inputPath: string,
  outputPath: string,
): Promise<{ size: number } | null> {
  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vn",
      "-b:a",
      "128k",
      "-y",
      outputPath,
    ]);
    const info = await stat(outputPath);
    return { size: info.size };
  } catch (err) {
    console.error("[summarize-api] audio extraction failed:", err);
    return null;
  }
}
