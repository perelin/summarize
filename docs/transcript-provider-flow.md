---
summary: "Map of transcript provider selection and transcription fallback flow."
read_when:
  - "When changing podcast, YouTube, or generic transcript provider order."
  - "When changing remote transcription fallbacks or provider setup errors."
---

# Transcript Provider Flow

Goal: keep provider entrypoints thin; keep provider policy explicit.

## Provider entrypoints

- `src/core/content/transcript/providers/youtube.ts`
  YouTube orchestration only.
  Web captions first.
  `yt-dlp` or Apify fallback next.
- `src/core/content/transcript/providers/podcast.ts`
  Podcast orchestration only.
  Feed/Spotify/Apple/enclosure/`yt-dlp` chain.
- `src/core/content/transcript/providers/generic.ts`
  Embedded tracks first.
  Direct-media / X media fallback next.

## Shared policy

- `transcription-capability.ts`
  One place for:
  - `resolveTranscriptProviderCapabilities`
  - `canTranscribe`
  - `canRunYtDlp`
  - missing-provider note/result shaping
- `transcription-start.ts`
  Runtime availability only.
  Local whisper, ONNX, cloud presence, display hints.

## Remote fallback

- `src/core/transcription/whisper/cloud-providers.ts`
  Provider order + labels + model-id chain.
- `src/core/transcription/whisper/remote-provider-attempts.ts`
  Per-provider byte/file attempts.
- `src/core/transcription/whisper/remote.ts`
  Order loop only.
  Fallback notes.
  OpenAI chunk/delegate policy.

## Current order

- local ONNX / whisper.cpp before cloud
- cloud bytes/file order:
  - Mistral (Voxtral)
  - AssemblyAI
  - Gemini
  - OpenAI
  - FAL

## Rules

- keep entrypoints thin
- add provider notes in shared helpers, not scattered strings
- prefer pure parser helpers before touching orchestration
- if adding a new provider:
  - register cloud metadata
  - add remote attempt handler
  - widen shared capability helper
  - add focused provider tests before live tests
