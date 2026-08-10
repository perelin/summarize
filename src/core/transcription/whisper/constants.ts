export const TRANSCRIPTION_TIMEOUT_MS = 600_000;
export const MAX_ERROR_DETAIL_CHARS = 200;
export const MAX_OPENAI_UPLOAD_BYTES = 24 * 1024 * 1024;
// Voxtral Transcribe 2 accepts recordings up to 3 hours per request; a 110 MB
// upload was verified to succeed. Keeping the whole recording in one request is
// what makes diarization usable — speaker ids are only consistent within a
// single request, so every chunk boundary renumbers the speakers.
export const MAX_MISTRAL_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_MISTRAL_AUDIO_SECONDS = 2.5 * 60 * 60;
export const MISTRAL_SEGMENT_SECONDS = 3600;
export const DEFAULT_SEGMENT_SECONDS = 600;
export const DISABLE_LOCAL_WHISPER_CPP_ENV = "SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP";
export const WHISPER_CPP_MODEL_PATH_ENV = "SUMMARIZE_WHISPER_CPP_MODEL_PATH";
export const WHISPER_CPP_BINARY_ENV = "SUMMARIZE_WHISPER_CPP_BINARY";
