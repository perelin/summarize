---
summary: "Transcript timestamps plan + clickable chat jumps."
read_when:
  - "When planning transcript timestamps or click-to-seek UX."
---

# Transcript Timestamps Plan

Short scope

- Request timed transcripts via the API.
- Preserve existing plain transcript text; add structured segments + timed text.
- Chat mode: include timed transcript + prompt for `[mm:ss]` references.
- Coverage: YouTube, podcasts, embedded captions, generic media; whisper.cpp = no segments unless we add verbose output later.

## 1) API / data model

- New option: `FetchLinkContentOptions.transcriptTimestamps?: boolean`.
- Thread through provider options (`ProviderFetchOptions`).
- New types:
  - `TranscriptSegment`: `{ startMs: number; endMs?: number | null; text: string }`.
  - `TranscriptResolution.segments?: TranscriptSegment[] | null`.
  - `ExtractedLinkContent.transcriptSegments?: TranscriptSegment[] | null`.
  - `ExtractedLinkContent.transcriptTimedText?: string | null` (helper).
- Keep `TranscriptResolution.text` unchanged (plain transcript).

Notes

- Timestamps should only alter output when requested; default output remains stable.
- For JSON output, include both `transcriptSegments` and `transcriptTimedText` when requested.

## 2) Provider updates

YouTube (youtubei)

- Parse `startMs` (and duration if present) from `transcriptSegmentRenderer`.
- Build segments array; `text` still plain (join of text).

YouTube (captionTracks json3 / xml)

- json3 provides `events[].tStartMs` and `dDurationMs`; parse segments from `events.segs[].utf8`.
- XML captions include `start` + `dur`; parse segments when present.

Podcast RSS transcripts

- VTT parser should output segments (start/end + cue text).
- JSON transcript: support `segments` with `start`/`startMs` + `end`/`endMs` + `text`.
- Plain text transcripts: `segments = null`.

Generic embedded captions

- When track is VTT/JSON, parse into segments; otherwise `null`.

yt-dlp / whisper / whisper.cpp

- Keep `segments = null` (plain text only).
- Optional future: request verbose or SRT output from OpenAI/FAL when supported.

## 3) Cache behavior

- Store `segments` in transcript metadata (or dedicated cache field).
- If timestamps requested and cached transcript lacks segments, treat as miss and refetch.
- Keep cache keys stable; only bypass when timestamps requested.

## 4) Chat prompt + content

- `buildChatPageContent`: when timestamps requested, include `Timed transcript:` block using `[mm:ss]`.
- `buildChatSystemPrompt`: add instruction:
  - “When referencing moments, include `[mm:ss]` timestamps from the transcript.”

## 5) Tests

Core

- youtubei transcript parsing yields segments + plain text.
- captionTracks json3 + xml yield segments.
- VTT parser yields segments.
- Cache: timestamps requested + cached without segments → refetch.

## 6) Changelog

- Entry: timed transcripts in chat, podcast support.

## 7) Notes / open

- “VisPoR” = whisper.cpp: no timestamps unless we add verbose output path.
- Decide exact format of `transcriptTimedText` (recommend `[mm:ss] text` per line).
