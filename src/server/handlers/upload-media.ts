import { randomUUID } from "node:crypto";
/**
 * Audio/video upload handler: writes the uploaded file to a temp directory,
 * then uses createLinkPreviewClient to transcribe it via the file:// URL scheme.
 *
 * The returned transcript text can then be fed into the summarization pipeline.
 */
import { rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLinkPreviewClient } from "../../content/index.js";
import { resolveExecutableInPath } from "../../run/env.js";

export async function transcribeUploadedMedia(
  file: { name: string; type: string; bytes: Uint8Array },
  options: {
    env: Record<string, string | undefined>;
    fetchImpl: typeof fetch;
  },
): Promise<{ transcript: string; durationSeconds: number | null }> {
  // Write to a temp file so the link preview client can access it via file:// URL
  const tempDir = join(tmpdir(), `summarize-upload-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  const tempPath = join(tempDir, file.name);

  try {
    await writeFile(tempPath, file.bytes);

    const fileUrl = `file://${tempPath}`;

    const env = options.env;
    const ytDlpPath =
      (typeof env.YT_DLP_PATH === "string" ? env.YT_DLP_PATH.trim() : "") ||
      resolveExecutableInPath("yt-dlp", env);
    const client = createLinkPreviewClient({
      env,
      fetch: options.fetchImpl,
      ytDlpPath,
      mistralApiKey: env.MISTRAL_API_KEY ?? null,
      groqApiKey: env.GROQ_API_KEY ?? null,
      assemblyaiApiKey: env.ASSEMBLYAI_API_KEY ?? null,
      geminiApiKey:
        env.GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY ?? null,
      openaiApiKey: env.OPENAI_API_KEY ?? null,
      falApiKey: env.FAL_API_KEY ?? null,
      onProgress: (event) => {
        console.log(`[upload-media] transcription progress: ${event.kind}`);
      },
    });

    const result = await client.fetchLinkContent(fileUrl, {
      mediaTranscript: "prefer",
      timeoutMs: 300_000,
    });

    const transcript = result.content?.trim();
    if (!transcript) {
      throw new Error(
        "Transcription produced no text. The audio may be silent or the file format unsupported.",
      );
    }

    return {
      transcript,
      durationSeconds: result.mediaDurationSeconds ?? null,
    };
  } finally {
    // Clean up temp file
    await rm(tempDir, { recursive: true, force: true }).catch(() => {
      /* best-effort cleanup */
    });
  }
}
