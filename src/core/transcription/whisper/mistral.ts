import { MAX_ERROR_DETAIL_CHARS, TRANSCRIPTION_TIMEOUT_MS } from "./constants.js";
import { ensureWhisperFilenameExtension, toArrayBuffer } from "./utils.js";

export async function transcribeWithMistral(
  bytes: Uint8Array,
  mediaType: string,
  filename: string | null,
  apiKey: string,
): Promise<string | null> {
  const form = new FormData();
  const providedName = filename?.trim() ? filename.trim() : "media";
  const safeName = ensureWhisperFilenameExtension(providedName, mediaType);
  form.append("file", new Blob([toArrayBuffer(bytes)], { type: mediaType }), safeName);
  form.append("model", "voxtral-mini-latest");

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

  const payload = (await response.json()) as { text?: unknown };
  if (typeof payload?.text !== "string") return null;
  const trimmed = payload.text.trim();
  return trimmed.length > 0 ? trimmed : null;
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
