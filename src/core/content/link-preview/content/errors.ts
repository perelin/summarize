/**
 * Thrown when a YouTube video URL yields no transcript (captions unavailable
 * AND audio transcription failed). We refuse to silently summarize the video's
 * short description in that case, because a "summary" built from a ~20-word
 * blurb reads as confident but is effectively hallucinated. Callers surface
 * this as a user-visible error instead.
 */
export class TranscriptUnavailableError extends Error {
  readonly code = "TRANSCRIPT_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "TranscriptUnavailableError";
  }
}
