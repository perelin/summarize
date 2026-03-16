# Original Media Preservation + Audio Extract

**Date:** 2026-03-16
**Status:** Implementing

## Problem

1. **Uploaded files are discarded** after processing — only size/type metadata is recorded, the actual file bytes are lost.
2. **No separate audio track** — when a video is summarized, there's no way to download just the audio.

## Solution

Always persist the original media file to history storage. For video sources, additionally extract the audio track as a separate downloadable MP3.

## Schema Changes

Add 3 columns to the `history` table via `ALTER TABLE` migration at startup:

```sql
ALTER TABLE history ADD COLUMN audio_path TEXT;
ALTER TABLE history ADD COLUMN audio_size INTEGER;
ALTER TABLE history ADD COLUMN audio_type TEXT;
```

**Semantics:**

- `media_path` = original file (video, audio, PDF, image)
- `audio_path` = extracted audio (only for video sources)

## API Changes

### New endpoint: `GET /v1/history/:id/audio`

Serves the extracted audio file. Same auth as `/media`. Returns 404 if no audio extract exists.

### Updated: `GET /v1/history/:id`

Response gains: `hasAudio: boolean`, `audioUrl: string | null`, `audioSize: number | null`, `audioType: string | null`.

### Updated: `DELETE /v1/history/:id`

Also deletes the audio file from disk.

## Backend Logic

### Uploaded files (multipart)

1. After summarization, write original file bytes to `{historyMediaPath}/{summaryId}{ext}`
2. If `uploadType === "video"`: extract audio via ffmpeg to `{summaryId}_audio.mp3`
3. Insert history with both `mediaPath` and `audioPath`

### URL-sourced media

1. Copy from media cache to history (existing behavior — this is the original)
2. If `sourceType === "video"`: extract audio via ffmpeg to `{summaryId}_audio.mp3`
3. Insert history with both paths

### Audio extraction

New utility: `src/server/utils/extract-audio.ts`

- Uses ffmpeg: `-i input -vn -b:a 128k output.mp3`
- 128kbps for listenable quality (vs 64kbps/16kHz used for transcription)
- Graceful failure: if ffmpeg unavailable or fails, skip audio extract

## Frontend Changes

### `summary-detail.tsx` MetaBar

- Original download: `↓ Original ({size})` — always shown when media exists
- Audio download: `↓ Audio ({size})` — shown when audio extract exists
- Labels differentiate clearly between the two assets

### Types (`api.ts`)

- `HistoryEntry` gains: `audioPath`, `audioSize`, `audioType`
- `HistoryDetailEntry` gains: `hasAudio`, `audioUrl`

## Files Modified

| File                                         | Change                                                 |
| -------------------------------------------- | ------------------------------------------------------ |
| `src/history.ts`                             | Schema migration, types, INSERT/mapRow                 |
| `src/server/routes/history.ts`               | New `/audio` endpoint, detail response, delete cleanup |
| `src/server/routes/summarize.ts`             | Save uploads, extract audio for video                  |
| `src/server/utils/extract-audio.ts`          | New: ffmpeg audio extraction utility                   |
| `apps/web/src/lib/api.ts`                    | Frontend types                                         |
| `apps/web/src/components/summary-detail.tsx` | Download links UI                                      |
