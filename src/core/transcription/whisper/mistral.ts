import { MAX_ERROR_DETAIL_CHARS, TRANSCRIPTION_TIMEOUT_MS } from "./constants.js";
import { ensureWhisperFilenameExtension, toArrayBuffer } from "./utils.js";

export const MISTRAL_TRANSCRIPTION_MODEL = "voxtral-mini-latest";
export const MISTRAL_DIARIZE_ENV = "SUMMARIZE_MISTRAL_DIARIZE";

type Env = Record<string, string | undefined>;

type MistralSegment = {
  text?: unknown;
  speaker_id?: unknown;
};

type MistralTranscriptionResponse = {
  text?: unknown;
  segments?: unknown;
};

/** Diarization is on unless explicitly disabled via SUMMARIZE_MISTRAL_DIARIZE=0/false/off. */
export function resolveMistralDiarize(env: Env = process.env): boolean {
  const raw = env[MISTRAL_DIARIZE_ENV]?.trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

export async function transcribeWithMistral(
  bytes: Uint8Array,
  mediaType: string,
  filename: string | null,
  apiKey: string,
  { env = process.env }: { env?: Env } = {},
): Promise<string | null> {
  const form = new FormData();
  const providedName = filename?.trim() ? filename.trim() : "media";
  const safeName = ensureWhisperFilenameExtension(providedName, mediaType);
  form.append("file", new Blob([toArrayBuffer(bytes)], { type: mediaType }), safeName);
  form.append("model", MISTRAL_TRANSCRIPTION_MODEL);
  const diarize = resolveMistralDiarize(env);
  if (diarize) {
    // Voxtral rejects diarize=true unless segment granularity is requested as well.
    form.append("diarize", "true");
    form.append("timestamp_granularities", "segment");
  }

  const response = await globalThis.fetch("https://api.mistral.ai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    const suffix = detail ? `: ${detail}` : "";
    throw new Error(`Mistral transcription failed (${response.status})${suffix}`);
  }

  const payload = (await response.json()) as MistralTranscriptionResponse;
  const diarized = diarize ? formatDiarizedTranscript(payload.segments) : null;
  if (diarized) return diarized;

  if (typeof payload?.text !== "string") {
    console.error(
      `[transcription] Mistral response missing text field: ${JSON.stringify(payload).slice(0, 500)}`,
    );
    return null;
  }
  const trimmed = payload.text.trim();
  if (trimmed.length === 0) {
    console.error(
      `[transcription] Mistral returned empty text. Input: ${safeName} ${bytes.byteLength}B mediaType=${mediaType}`,
    );
  }
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Renders diarized segments as speaker-labelled paragraphs, merging consecutive
 * segments of the same speaker. Returns null when diarization adds nothing
 * (no segments, or a single speaker) so callers fall back to the plain text.
 */
export function formatDiarizedTranscript(segments: unknown): string | null {
  if (!Array.isArray(segments)) return null;
  const usable = segments
    .filter((segment): segment is MistralSegment => Boolean(segment) && typeof segment === "object")
    .map((segment) => ({
      text: typeof segment.text === "string" ? segment.text.trim() : "",
      speaker: typeof segment.speaker_id === "string" ? segment.speaker_id.trim() : "",
    }))
    .filter((segment) => segment.text.length > 0 && segment.speaker.length > 0);
  if (usable.length === 0) return null;
  if (new Set(usable.map((segment) => segment.speaker)).size < 2) return null;

  const blocks: { speaker: string; parts: string[] }[] = [];
  for (const segment of usable) {
    const current = blocks.at(-1);
    if (current?.speaker === segment.speaker) current.parts.push(segment.text);
    else blocks.push({ speaker: segment.speaker, parts: [segment.text] });
  }
  return blocks
    .map((block) => `${formatSpeakerLabel(block.speaker)}: ${block.parts.join(" ")}`)
    .join("\n\n");
}

function formatSpeakerLabel(speakerId: string): string {
  const match = /^speaker[_\s-]?(\d+)$/i.exec(speakerId);
  return match ? `Speaker ${match[1]}` : speakerId;
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed) return null;
    return trimmed.length > MAX_ERROR_DETAIL_CHARS
      ? `${trimmed.slice(0, MAX_ERROR_DETAIL_CHARS)}…`
      : trimmed;
  } catch {
    return null;
  }
}
