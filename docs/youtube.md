---
summary: "YouTube transcript extraction modes and fallbacks."
read_when:
  - "When changing YouTube handling."
---

# YouTube mode

YouTube URLs use transcript-first extraction.

## YouTube mode (`youtube` API parameter)

Values: `auto` (default), `web`, `no-auto`, `apify`, `yt-dlp`

- `auto`: try `youtubei` → `captionTracks` → `yt-dlp` subtitles (if configured) → `yt-dlp` audio (if configured) → Apify (if token exists)
- `web`: try `youtubei` → `captionTracks` only
- `no-auto`: try creator captions only (skip auto-generated/ASR) → `yt-dlp` creator subtitles → `yt-dlp` audio (if configured)
- `apify`: Apify only
- `yt-dlp`: download audio + transcribe (Mistral Voxtral first — with speaker labels — then Groq; then local `whisper.cpp`; then AssemblyAI/Gemini/OpenAI/FAL fallback)

## `youtubei` vs `captionTracks`

- `youtubei`:
  - Calls YouTube’s internal transcript endpoint (`/youtubei/v1/get_transcript`).
  - Needs a bootstrapped `INNERTUBE_API_KEY`, context, and `getTranscriptEndpoint.params` from the watch page HTML.
  - When it works, you get a nice list of transcript segments.
- `captionTracks`:
  - Downloads caption tracks listed in `ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks`.
  - Fetches `fmt=json3` first and falls back to XML-like caption payloads if needed.
  - Often works even when the transcript endpoint doesn’t.

## `yt-dlp` subtitles

The watch page frequently no longer carries `captionTracks` for anonymous requests, so
`youtubei` and `captionTracks` come up empty even for videos that _do_ have captions.
yt-dlp reaches the same tracks through the player API, so `auto` mode asks it for
subtitles (`--skip-download --write-subs/--write-auto-subs --sub-format json3`) before
falling back to an audio download plus paid transcription. Creator tracks are requested
first, auto-captions second; per language the original (`.*-orig`) and English are
preferred. Reported as transcript source `yt-dlp-subs`.

This rung only needs the `yt-dlp` binary — no transcription provider — and it is not
subject to the HTTP 403 that YouTube returns for _media_ fetches from server IPs without
a PO token.

## Fallbacks

- If no transcript is available, we still extract `ytInitialPlayerResponse.videoDetails.shortDescription` so YouTube links can still summarize meaningfully.
- Apify is an optional fallback (needs `APIFY_API_TOKEN`).
  - By default, we use the actor id `faVsWy9VTSNVIhWpR` (Pinto Studio’s “Youtube Transcript Scraper”).
- `yt-dlp` requires the `yt-dlp` binary (either set `YT_DLP_PATH` or have it on `PATH`) and either local `whisper.cpp` or one of `GROQ_API_KEY`, `ASSEMBLYAI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `FAL_KEY`.
  - AssemblyAI is supported as a dedicated remote transcription provider in the fallback chain.
  - Gemini is used automatically when available after AssemblyAI/local providers, and handles larger uploads via the Files API.
  - If OpenAI transcription fails and `FAL_KEY` is set, we fall back to FAL automatically.

If yt-dlp gets a 403 from YouTube, set `SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER=chrome` (or
`chrome:Profile 1`) to pass cookies through to yt-dlp.
