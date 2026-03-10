# API Server

HTTP API for programmatic summarization. POST a URL or text, get a JSON summary back.

Separate from the browser extension daemon — designed for scripts, automation, and server-to-server use.

## Quick start

```bash
# 1. Build
pnpm build

# 2. Set required env vars
export SUMMARIZE_API_TOKEN="your-secret-token"
export ANTHROPIC_API_KEY="sk-..."  # at least one LLM key

# 3. Run
node dist/esm/server/main.js
```

The server listens on `http://0.0.0.0:3000` by default.

## Web frontend

The server includes a built-in web UI at the root URL:

```
http://localhost:3000/?token=your-secret-token
```

Features:
- Summarize URLs or paste text directly
- Choose summary length (tiny/short/medium/long/xlarge)
- Rendered markdown output with metadata (model, duration, tokens)

The token is passed as a query parameter — bookmark the URL for quick access.

## Docker

```bash
docker build -t summarize-api .
docker run -p 3000:3000 --env-file .env summarize-api
```

See `.env.example` for all available environment variables.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUMMARIZE_API_TOKEN` | Yes | — | Bearer token for API authentication |
| `SUMMARIZE_API_PORT` | No | `3000` | Server listen port |
| `SUMMARIZE_DEFAULT_MODEL` | No | config default | Default LLM model when request doesn't specify one (e.g. `openai/claude-sonnet-4-6`) |

LLM and transcription keys are configured the same as the CLI — see the main README. At minimum, set one LLM provider key (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

For audio/video URL transcription, set at least one transcription key. The provider chain is: Mistral Voxtral (`MISTRAL_API_KEY`) > Groq (`GROQ_API_KEY`) > AssemblyAI (`ASSEMBLYAI_API_KEY`) > Gemini (`GEMINI_API_KEY`) > OpenAI (`OPENAI_API_KEY`) > FAL (`FAL_KEY`).

## Endpoints

### `GET /v1/health`

No authentication required.

```bash
curl http://localhost:3000/v1/health
```

```json
{"status": "ok"}
```

### `POST /v1/summarize`

Requires `Authorization: Bearer <token>` header.

#### Summarize a URL

```bash
curl -X POST http://localhost:3000/v1/summarize \
  -H "Authorization: Bearer $SUMMARIZE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article", "length": "short"}'
```

#### Summarize text

```bash
curl -X POST http://localhost:3000/v1/summarize \
  -H "Authorization: Bearer $SUMMARIZE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Long article content to summarize...", "length": "medium"}'
```

#### Extract content only (no LLM summary)

```bash
curl -X POST http://localhost:3000/v1/summarize \
  -H "Authorization: Bearer $SUMMARIZE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article", "extract": true}'
```

#### Request body

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | One of `url` or `text` | — | HTTP/HTTPS URL to summarize |
| `text` | string | One of `url` or `text` | — | Raw text to summarize |
| `length` | string | No | `"medium"` | `"tiny"`, `"short"`, `"medium"`, `"long"`, `"xlarge"` |
| `model` | string | No | config default | LLM model ID (e.g. `"anthropic/claude-sonnet-4"`) |
| `extract` | boolean | No | `false` | Return extracted content instead of a summary |

#### Response (200)

```json
{
  "summary": "Markdown summary text...",
  "metadata": {
    "title": "Article Title",
    "source": "https://example.com/article",
    "model": "anthropic/claude-sonnet-4",
    "usage": {"inputTokens": 1234, "outputTokens": 567},
    "durationMs": 3400
  }
}
```

`metadata.usage` is `null` when token counts are unavailable (e.g. extract-only mode).

#### Errors

```json
{"error": {"code": "INVALID_INPUT", "message": "Must provide url or text"}}
```

| Status | Code | When |
|--------|------|------|
| 400 | `INVALID_INPUT` | Missing/invalid fields |
| 401 | `UNAUTHORIZED` | Missing or invalid bearer token |
| 500 | `SERVER_ERROR` / `INTERNAL_ERROR` | Unexpected server error |
| 501 | `NOT_IMPLEMENTED` | File upload (not yet supported) |
| 504 | `TIMEOUT` | Request timed out |

Body size limit: 10 MB.

## Caching

The API server shares the same SQLite cache (`~/.summarize/cache.sqlite`) and media cache (`~/.summarize/cache/media/`) as the CLI and browser extension daemon. Repeated requests for the same URL with the same model/length return cached results without additional LLM or transcription calls.

## Architecture

```
src/server/
  main.ts               — Entry point (Node HTTP server, env loading)
  index.ts              — Hono app factory + middleware (logger, auth, body limit)
  types.ts              — Request/response TypeScript types
  middleware/
    auth.ts             — Bearer token validation (timing-safe compare)
  routes/
    health.ts           — GET /v1/health
    summarize.ts        — POST /v1/summarize (URL, text, extract modes)
  utils/
    length-map.ts       — API length names → internal length names
```

The server reuses the existing summarization pipeline (`src/daemon/summarize.ts`) — no duplicated logic.

## Limitations

- **Sync only** — no streaming, no job queues. Long requests (e.g. podcast transcription) may take >2 min.
- **No file upload** — multipart/form-data returns 501. URL and text modes only.
- **Same-origin frontend** — the built-in web UI is served from the same server, so no CORS headers are needed. External browser clients would need CORS to be added.
- **No rate limiting** — protect with a reverse proxy if exposed publicly.
- **Single process** — no clustering or worker threads.
