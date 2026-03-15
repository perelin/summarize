# Summarize_p2 — Web API + Preact Frontend

Fast summaries from URLs, files, and media. Web API server with a Preact frontend.

## Highlights

- **Web API** for programmatic summarization (POST JSON or SSE streaming).
- **Preact frontend** with chat, slides, and history.
- YouTube slides: screenshots + OCR + transcript cards, timestamped seek.
- Media-aware summaries: auto-detect video/audio vs page content.
- Streaming Markdown + metrics + cache-aware status.

## Feature overview

- URLs, files, and media: web pages, PDFs, images, audio/video, YouTube, TikTok, podcasts, RSS.
- Slide extraction for video sources (YouTube/direct media) with OCR + timestamped cards.
- Transcript-first media flow: published transcripts when available, then Groq/ONNX/whisper.cpp/AssemblyAI/Gemini/OpenAI/FAL transcription fallback when not.
- Streaming output with Markdown rendering, metrics, and cache-aware status.
- Local, paid, and free models: OpenAI-compatible local endpoints, paid providers, plus an OpenRouter free preset.
- Output modes: Markdown/text, JSON diagnostics, extract-only, metrics, timing, and cost estimates.
- Smart default: if content is shorter than the requested length, return it as-is.

## API Server

HTTP API for programmatic summarization — POST a URL or text, get a JSON summary back.

### Quick start

```bash
export ANTHROPIC_API_KEY="sk-..."
node dist/esm/server/main.js
```

```bash
curl -X POST http://localhost:3000/v1/summarize \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "length": "short"}'
```

Docker: `docker build -t summarize-api . && docker run -p 3000:3000 --env-file .env summarize-api`

Full docs: [docs/api-server.md](docs/api-server.md)

### Endpoints

- `POST /v1/summarize` — summarize a URL (JSON or SSE)
- `GET /v1/history` — list past summaries
- `POST /v1/chat` — chat about a summary
- `GET /v1/summarize/:id/slides` — get slides for a summary
- `GET /v1/slides/:sourceId/:index` — get a single slide image
- `GET /v1/me` — current account info

### Web Frontend

Dev: `pnpm -C apps/web dev` (Vite on port 5173, proxies `/v1` to API on port 3000)
Build: `pnpm -C apps/web build`

## Model ids

Use gateway-style ids: `<provider>/<model>`.

Examples:

- `openai/gpt-5-mini`
- `anthropic/claude-sonnet-4-5`
- `xai/grok-4-fast-non-reasoning`
- `google/gemini-3-flash`
- `zai/glm-4.7`
- `openrouter/openai/gpt-5-mini` (force OpenRouter)

## Output length

The `length` parameter controls how much output we ask for (guideline), not a hard cap.

- Presets: `short|medium|long|xl|xxl`
- Character targets: `1500`, `20k`, `20000`
- Optional hard cap: `maxOutputTokens` (e.g. `2000`, `2k`)
- Preset targets (source of truth: `src/core/prompts/summary-lengths.ts`):
  - short: target ~900 chars (range 600-1,200)
  - medium: target ~1,800 chars (range 1,200-2,500)
  - long: target ~4,200 chars (range 2,500-6,000)
  - xl: target ~9,000 chars (range 6,000-14,000)
  - xxl: target ~17,000 chars (range 14,000-22,000)

## Configuration

Config location: `~/.summarize/config.json`

```json
{
  "accounts": [{ "name": "default", "token": "your-secret-token" }],
  "model": { "id": "openai/gpt-5-mini" },
  "env": { "OPENAI_API_KEY": "sk-..." }
}
```

Also supported:

- `model: { "mode": "auto" }` (automatic model selection + fallback)
- `model.rules` (customize candidates / ordering)
- `models` (define presets selectable via `model` parameter)
- `env` (generic env var defaults; process env still wins)
- `apiKeys` (legacy shortcut, mapped to env names; prefer `env` for new configs)
- `cache.media` (media download cache: TTL 7 days, 2048 MB cap by default)
- `media.videoMode: "auto"|"transcript"|"understand"`
- `slides.enabled` / `slides.max` / `slides.ocr` / `slides.dir`
- `openai.useChatCompletions: true` (force OpenAI-compatible chat completions)

## Environment variables

Set the key matching your chosen model:

- `OPENAI_API_KEY` (for `openai/...`)
- `NVIDIA_API_KEY` (for `nvidia/...`)
- `ANTHROPIC_API_KEY` (for `anthropic/...`)
- `XAI_API_KEY` (for `xai/...`)
- `Z_AI_API_KEY` (for `zai/...`; supports `ZAI_API_KEY` alias)
- `GEMINI_API_KEY` (for `google/...`)
  - also accepts `GOOGLE_GENERATIVE_AI_API_KEY` and `GOOGLE_API_KEY` as aliases
- `OPENROUTER_API_KEY` (for `openrouter/...`)

Optional services:

- `FIRECRAWL_API_KEY` (website extraction fallback)
- `YT_DLP_PATH` (path to yt-dlp binary for audio extraction)
- `GROQ_API_KEY` (Groq Whisper transcription)
- `ASSEMBLYAI_API_KEY` (AssemblyAI transcription)
- `FAL_KEY` (FAL AI API key for audio transcription via Whisper)
- `APIFY_API_TOKEN` (YouTube transcript fallback)

## Optional local dependencies

Install these if you want media-heavy features:

- `ffmpeg`: required for slides and many local media/transcription flows
- `yt-dlp`: required for YouTube slide extraction, TikTok video transcription
- `tesseract`: optional OCR for slide OCR
- Optional cloud transcription providers (alternative to local whisper):
  - `GROQ_API_KEY`, `ASSEMBLYAI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `FAL_KEY`

## Development

```bash
pnpm install
pnpm check
```

## More

- YouTube handling: [docs/youtube.md](docs/youtube.md)
- Media pipeline: [docs/media.md](docs/media.md)
- API server: [docs/api-server.md](docs/api-server.md)
- Deployment: [docs/deployment.md](docs/deployment.md)

License: MIT
