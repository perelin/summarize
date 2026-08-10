---
summary: "Embedded media detection + transcript-first pipeline."
read_when:
  - "When changing media detection, embedded captions, or video-mode behavior."
---

# Media detection + transcript-first

## Detection (HTML)

- Embedded video/audio: `<video>` / `<audio>` tags, `og:video` / `og:audio`, iframe embeds (YouTube/Vimeo/Twitch/Wistia, Spotify/SoundCloud/Podcasts).
- Captions: `<track kind="captions|subtitles" src=...>`.

## Transcript resolution order

1. Embedded captions (VTT/JSON) when available.
2. yt-dlp download + transcription (Mistral Voxtral first, then Groq; then ONNX/local whisper.cpp; then AssemblyAI/Gemini/OpenAI/FAL fallback).

## Speaker diarization (Mistral Voxtral)

- Mistral leads the chain because it is the only provider here that returns speaker labels. Transcripts come back as `Speaker 1: …` paragraphs, one block per speaker turn; a recording with a single detected speaker stays plain text.
- Requires `MISTRAL_API_KEY`. Model: `voxtral-mini-latest` (currently Voxtral Transcribe 2), $0.003/min of audio.
- Disable with `SUMMARIZE_MISTRAL_DIARIZE=0` (also accepts `false`/`off`/`no`) to get plain transcripts.
- Speaker ids are only consistent **within one request**, so recordings stay whole up to 100 MB / 2.5 h (a 110 MB upload was verified to work; Mistral documents 3 h per request). Beyond that the file is chunked into hour-long segments and each part restarts at `Speaker 1` — a note is added to the result when that happens.
- Groq (`whisper-large-v3-turbo`) has no diarization and remains the fast fallback when Mistral fails or is not configured.

## Behavior

- Direct media URLs (mp4/webm/m4a/etc) skip HTML and transcribe.
- YouTube still uses the YouTube transcript pipeline (captions → yt-dlp fallback).
- X/Twitter status URLs with detected video auto-switch to transcript-first (yt-dlp), even in auto mode.
- X broadcasts (`/i/broadcasts/...`) are treated as media-only and go transcript-first by default.
- Local media files are capped at 2 GB; remote media URLs are best-effort via yt-dlp (no explicit size limit).
- Remote transcription providers: `MISTRAL_API_KEY` (primary), `ASSEMBLYAI_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `FAL_KEY` (plus `GROQ_API_KEY` before local/remote fallback).
- Gemini uses the Files API automatically for larger uploads.

## Known limits

- No auth/cookie handling for embedded media; login-gated assets will fail.
- Captions are best-effort; if captions are missing or unreadable, we fall back to transcription.
