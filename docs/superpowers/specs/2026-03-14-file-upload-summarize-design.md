# File Upload & Summarization Design

**Date:** 2026-03-14
**Status:** Approved

## Summary

Add support for uploading raw media files (PDFs, images, audio, video) to the web frontend and API server. Users can drag-and-drop, paste from clipboard, or browse for files — the system auto-detects the file type and routes to the appropriate processing pipeline.

## Requirements

- **Single file per request**, max 200 MB
- **Supported file types:**
  - PDF → extract text via `pdf-parse`, summarize as text
  - Images (PNG, JPG, GIF, WebP, SVG) → send to vision-capable LLM for description + text extraction
  - Audio (MP3, M4A, WAV, FLAC, AAC, OGG, OPUS) → existing transcription pipeline
  - Video (MP4, MOV, MKV, WEBM) → existing transcription pipeline
- **Input methods:** drag-and-drop, clipboard paste (images/files), file browse button
- **Unified input area:** replaces current URL/Text tab switcher with a single textarea that auto-detects URLs, text, or files

## Architecture

### Frontend (apps/web)

#### Unified Input Component

Replace the current `SummarizeView` form with a unified input that has these states:

1. **Empty** — textarea with dashed border, placeholder "Paste a URL, drop a file, or type text to summarize...", type badges (PDF/Images/Audio/Video), Browse button
2. **Drag hover** — border turns accent color, content replaced with "Drop to summarize" overlay
3. **File attached** — textarea replaced by file card (icon, filename, size, remove button)
4. **URL detected** — auto-detected via regex when text starts with `http(s)://`, small badge indicator
5. **Freeform text** — plain textarea content, no special treatment
6. **Error** — file too large or unsupported type, red-tinted card with error message

**Auto-detection logic:**

- If a file is attached → file mode (multipart upload)
- If text matches URL pattern → URL mode (existing JSON flow)
- Otherwise → text mode (existing JSON flow)

URL detection: text is a URL if `urlValue.trim()` matches `/^https?:\/\/\S+$/` (single URL, no surrounding text). Multi-line text or text with spaces around a URL → text mode.

**Event handlers:**

- `ondragover` / `ondragleave` → toggle drag hover state
- `ondrop` → extract file, validate type + size, show file card
- `onpaste` → check `clipboardData.items` for files/images; if found, treat as file; if text, insert normally
- Hidden `<input type="file">` triggered by Browse button, accepts `.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.mp3,.m4a,.wav,.flac,.aac,.ogg,.opus,.mp4,.mov,.mkv,.webm`

**File card:** Shows file type icon, filename (or "Pasted image"), human-readable size, remove (×) button. Images get a small thumbnail preview via `URL.createObjectURL()`.

#### API Client Changes (api.ts)

Add a new `summarizeFileSSE()` function:

```typescript
export function summarizeFileSSE(
  file: File,
  options: { length?: ApiLength },
  callbacks: { onInit; onStatus; onChunk; onMeta; onDone; onError; onMetrics },
): AbortController;
```

- Builds a `FormData` with `file` field + `length` field
- POSTs to `/v1/summarize` with `Accept: text/event-stream` (no explicit Content-Type — browser sets multipart boundary)
- SSE parsing identical to existing `summarizeSSE()` — extract shared SSE parser to avoid duplication

### Server (src/server)

#### Body Size Limit

The current 10 MB `bodyLimit` middleware at `src/server/index.ts:116` must be increased to 200 MB for multipart requests. Options:

- Simplest: increase the limit to 200 MB globally on `/v1/summarize` (JSON bodies are tiny, so this is safe)
- Or: apply conditionally based on content-type (more complex, marginal benefit)

**Decision: increase to 200 MB globally.** JSON request bodies are <1 KB, so the higher limit only matters for multipart.

#### Multipart Handling in Summarize Route

Replace the 501 stub in `createSummarizeRoute` with actual multipart parsing:

1. **Parse multipart** using Hono's built-in `c.req.parseBody()` (supports `multipart/form-data`)
2. **Extract form fields:** `file` (File object), `length` (string), `model` (string, optional)
3. **Validate:**
   - `file` field present and is a `File` object
   - File size ≤ 200 MB (209,715,200 bytes)
   - File extension or MIME in allowed list (detect by extension first, MIME as fallback — browsers report inconsistent MIME types, e.g. `.m4a` → `audio/x-m4a` or `audio/mp4`)
4. **Parse options:** `length` via `mapApiLength()`, `model` override
5. **Detect file type** from extension and MIME → route to handler

| Type  | Detection                              | Processing                                                               |
| ----- | -------------------------------------- | ------------------------------------------------------------------------ |
| PDF   | `application/pdf`, `.pdf`              | `pdf-parse` → extract text → `streamSummaryForVisiblePage()`             |
| Image | `image/*`, `.png/.jpg/.gif/.webp/.svg` | base64 encode → multimodal LLM call → stream summary                     |
| Audio | `audio/*`, known extensions            | Write to temp → `createLinkPreviewClient` → transcription → text summary |
| Video | `video/*`, known extensions            | Write to temp → `createLinkPreviewClient` → transcription → text summary |

#### PDF Processing

```
file buffer → pdf-parse → extracted text → streamSummaryForVisiblePage({ text, ... })
```

- Feeds extracted text to `streamSummaryForVisiblePage()` with `url: "upload://<filename>"` and `title: filename`
- Source type in history: `"document"`
- Edge case: scanned/image-only PDFs produce empty text — return 422 `EXTRACTION_FAILED` with "PDF appears to contain only images. Try uploading as an image instead."

#### Image Processing

```
file buffer → base64 encode → build multimodal LLM message → stream summary via summary engine
```

This is a **new capability** for the server. The server-side pipeline currently has no multimodal support. Implementation:

1. Read image file into a `Buffer`, encode as base64 data URI
2. Build a multimodal message array for the LLM:
   ```typescript
   [
     {
       role: "user",
       content: [
         { type: "image", source: { type: "base64", media_type: mimeType, data: base64Data } },
         { type: "text", text: imagePrompt },
       ],
     },
   ];
   ```
3. Use the existing `createModelClient()` / summary engine to call the LLM with multimodal content
4. Stream response chunks through the same SSE sink

The image prompt combines `buildFileSummaryPrompt()` guidance with vision-specific instructions: "Describe this image in detail. Extract any visible text, data, tables, or numbers. Then provide a comprehensive summary."

- Source type in history: `"image"`
- Image data is NOT stored in history (too large) — only the generated description/summary

#### Audio/Video Processing

```
file → write to temp dir → createLinkPreviewClient → fetchLinkContent(file:// URL) → transcript → streamSummaryForVisiblePage
```

**Cannot use `streamSummaryForUrl()`** — that function calls `runUrlFlow` which expects HTTP URLs and goes through the full URL pipeline (link preview, HTML fetching, etc.). Instead, follow the pattern from `src/run/flows/asset/media.ts`:

1. Write uploaded file to a temp directory (`os.tmpdir()` + `summarize-upload-<uuid>/`)
2. Create a `LinkPreviewClient` via `createLinkPreviewClient()` with the server's environment (API keys from `deps.env`)
3. Call `client.fetchLinkContent(pathToFileURL(tempPath).href, { mediaTranscript: "prefer" })`
4. This triggers the transcription provider chain (mistral → groq → assemblyai → gemini → openai → fal)
5. Feed the resulting transcript text to `streamSummaryForVisiblePage()` as text mode
6. Source type in history: `"podcast"` (audio) or `"video"` (video)
7. Store the temp file as history media (copy to `historyMediaPath` like URL-based media)

**Temp file cleanup:**

- On success: file is either copied to history media or deleted
- On error/abort: cleanup in a `finally` block using `fs.rm(tempDir, { recursive: true, force: true })`
- Safety net: temp files in `os.tmpdir()` are cleaned by the OS on reboot

#### History Integration

File uploads are recorded in history with:

- `sourceUrl`: `upload:<original-filename>` (not `file://` to avoid URI parsing issues)
- `sourceType`: `"document"` | `"image"` | `"podcast"` | `"video"`
- `transcript`: extracted text (PDF), image description (image), or transcription (audio/video)
- `mediaPath`: stored file for audio/video (same mechanism as URL-based media)

#### SSE Session Integration

File upload SSE path reuses the same infrastructure as URL/text summarization:

- `sseSessionManager.createSession(summaryId)` for session creation
- Same `pushAndBuffer` pattern for event replay on reconnection
- Same `init` → `status` → `chunk`\* → `meta` → `metrics` → `done` event sequence
- Reconnection via `GET /v1/summarize/:id/events` works identically

### New Dependencies

- `pdf-parse` — PDF text extraction (zero native deps, Docker-friendly, actively maintained)

### File Type Constants

New shared constant in `src/server/utils/file-types.ts`:

```typescript
export const ALLOWED_UPLOAD_TYPES = {
  pdf: { mimes: ["application/pdf"], exts: [".pdf"] },
  image: {
    mimes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"],
    exts: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"],
  },
  audio: {
    mimes: [
      "audio/mpeg",
      "audio/mp4",
      "audio/x-m4a",
      "audio/mp4a-latm",
      "audio/wav",
      "audio/x-wav",
      "audio/flac",
      "audio/aac",
      "audio/ogg",
      "audio/opus",
    ],
    exts: [".mp3", ".m4a", ".wav", ".flac", ".aac", ".ogg", ".opus"],
  },
  video: {
    mimes: ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"],
    exts: [".mp4", ".mov", ".mkv", ".webm"],
  },
} as const;

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
```

File type detection: check extension first (from `file.name`), fall back to MIME type. This avoids browser MIME inconsistencies.

### Deployment Notes

- **Caddy proxy:** No default body size limit, so 200 MB uploads should work. Verify no explicit `request_body` directive is set in the Caddy config on CT 100.
- **Docker image:** `pdf-parse` has zero native deps, no Dockerfile changes needed.
- **Memory:** Hono's `parseBody()` buffers the file in memory. For 200 MB files, this means ~200 MB heap per concurrent upload. Acceptable for the expected low-concurrency use case. If this becomes an issue, switch to streaming multipart parser later.

## Error Handling

- **Unsupported file type:** 422 with `UNSUPPORTED_FILE_TYPE` code
- **File too large:** 413 with `FILE_TOO_LARGE` code
- **PDF extraction failure / empty PDF:** 422 with `EXTRACTION_FAILED` code
- **No file in request:** 400 with `INVALID_INPUT` code
- **Transcription failure:** 502 with `TRANSCRIPTION_FAILED` code (reuses existing classification)
- **Image vision failure:** falls through to standard `classifyError()`

## Testing Strategy

- **Server tests:** multipart upload with mock files for each type (PDF, image, audio)
- **Validation tests:** file size limit, unsupported types, missing file field, empty PDF
- **Frontend:** manual testing of drag-drop, paste, browse across browsers

## Out of Scope

- Multiple file upload (single file only for now)
- Resumable/chunked uploads
- File type conversion (e.g., DOCX, EPUB)
- Server-side file storage/management beyond temp files and history
- Progress indication during file upload (the existing SSE status events cover processing progress)
- OCR fallback for scanned PDFs (future enhancement)
