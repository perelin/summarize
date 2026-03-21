# API Server

HTTP API for programmatic summarization. POST a URL or text, get a JSON summary back.

Designed for scripts, automation, and server-to-server use.

## Quick start

```bash
# 1. Build
pnpm build

# 2. Configure accounts in config.json (or set SUMMARIZE_DATA_DIR)
cat > config.json <<'JSON'
{
  "accounts": [
    { "name": "myname", "token": "your-secret-token-at-least-32-chars-long" }
  ]
}
JSON

# 3. Set at least one LLM key
export ANTHROPIC_API_KEY="sk-..."

# 4. Run
node dist/esm/server/main.js
```

The server listens on `http://0.0.0.0:3000` by default.

## Authentication

The server uses **accounts-based authentication** configured in `config.json` (set `SUMMARIZE_DATA_DIR` to the directory containing your `config.json`, or place it in the working directory). Each account has a `name` and a `token` (minimum 32 characters).

```json
{
  "accounts": [
    { "name": "alice", "token": "<token-a>" },
    { "name": "bob", "token": "<token-b>" }
  ]
}
```

Pass the token as a `Bearer` header:

```
Authorization: Bearer <token>
```

History and usage are tracked per account.


## Web frontend

The server includes a built-in Preact web UI at the root URL (`http://localhost:3000/`). The frontend prompts for a token on first visit and stores it in the browser.

Features:

- Summarize URLs or paste text directly
- Choose summary length (tiny/short/medium/long/xlarge)
- Rendered markdown output with metadata (model, duration, tokens)
- Chat follow-up on summaries
- Slide generation from summaries
- Browsable history

## Docker

```bash
docker build -t summarize-api .
docker run -p 3000:3000 \
  -v /path/to/config.json:/app/config.json:ro \
  --env-file .env \
  summarize-api
```

See `.env.example` for all available environment variables.

## Environment variables

| Variable                  | Required | Default        | Description                                                                           |
| ------------------------- | -------- | -------------- | ------------------------------------------------------------------------------------- |
| `SUMMARIZE_API_PORT`      | No       | `3000`         | Server listen port                                                                    |
| `SUMMARIZE_DEFAULT_MODEL` | No       | config default | Default LLM model when request doesn't specify one (e.g. `anthropic/claude-sonnet-4`) |

At minimum, set one LLM provider key (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

For audio/video URL transcription, set at least one transcription key. The provider chain is: Mistral Voxtral (`MISTRAL_API_KEY`) > Groq (`GROQ_API_KEY`) > AssemblyAI (`ASSEMBLYAI_API_KEY`) > Gemini (`GEMINI_API_KEY`) > OpenAI (`OPENAI_API_KEY`) > FAL (`FAL_KEY`).

## Endpoints

### `GET /v1/health`

No authentication required.

```bash
curl http://localhost:3000/v1/health
```

```json
{ "status": "ok" }
```

### `POST /v1/summarize`

Requires `Authorization: Bearer <token>` header.

#### Summarize a URL

```bash
curl -X POST http://localhost:3000/v1/summarize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article", "length": "short"}'
```

#### Summarize text

```bash
curl -X POST http://localhost:3000/v1/summarize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Long article content to summarize...", "length": "medium"}'
```

#### Extract content only (no LLM summary)

```bash
curl -X POST http://localhost:3000/v1/summarize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article", "extract": true}'
```

#### Request body

| Field     | Type    | Required               | Default        | Description                                           |
| --------- | ------- | ---------------------- | -------------- | ----------------------------------------------------- |
| `url`     | string  | One of `url` or `text` | —              | HTTP/HTTPS URL to summarize                           |
| `text`    | string  | One of `url` or `text` | —              | Raw text to summarize                                 |
| `length`  | string  | No                     | `"medium"`     | `"tiny"`, `"short"`, `"medium"`, `"long"`, `"xlarge"` |
| `model`   | string  | No                     | config default | LLM model ID (e.g. `"anthropic/claude-sonnet-4"`)     |
| `extract` | boolean | No                     | `false`        | Return extracted content instead of a summary         |

#### Response (200)

```json
{
  "summary": "Markdown summary text...",
  "metadata": {
    "title": "Article Title",
    "source": "https://example.com/article",
    "model": "anthropic/claude-sonnet-4",
    "usage": { "inputTokens": 1234, "outputTokens": 567 },
    "durationMs": 3400
  }
}
```

`metadata.usage` is `null` when token counts are unavailable (e.g. extract-only mode).

#### Errors

```json
{ "error": { "code": "INVALID_INPUT", "message": "Must provide url or text" } }
```

| Status | Code                              | When                            |
| ------ | --------------------------------- | ------------------------------- |
| 400    | `INVALID_INPUT`                   | Missing/invalid fields          |
| 401    | `UNAUTHORIZED`                    | Missing or invalid bearer token |
| 500    | `SERVER_ERROR` / `INTERNAL_ERROR` | Unexpected server error         |
| 501    | `NOT_IMPLEMENTED`                 | File upload (not yet supported) |
| 504    | `TIMEOUT`                         | Request timed out               |

Body size limit: 200 MB.

## History

The API server records each summarization request in a persistent SQLite history database. The following endpoints provide read and delete access to that history.

All history endpoints require `Authorization: Bearer <token>`.

### `GET /v1/history`

Returns a paginated, reverse-chronological list of history entries.

```bash
curl http://localhost:3000/v1/history?limit=20&offset=0 \
  -H "Authorization: Bearer $TOKEN"
```

Query parameters:

| Parameter | Default | Max | Description                 |
| --------- | ------- | --- | --------------------------- |
| `limit`   | `20`    | 100 | Number of entries to return |
| `offset`  | `0`     | —   | Number of entries to skip   |

Response (200):

```json
{
  "entries": [...],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

### `GET /v1/history/:id`

Returns the full detail for a single history entry, including the stored transcript.

```bash
curl http://localhost:3000/v1/history/abc123 \
  -H "Authorization: Bearer $TOKEN"
```

Returns 404 if the entry does not exist.

### `GET /v1/history/:id/media`

Streams the media file associated with a history entry with the correct `Content-Type` header.

```bash
curl http://localhost:3000/v1/history/abc123/media \
  -H "Authorization: Bearer $TOKEN" \
  -o output.mp3
```

Returns 404 if no media file is stored for the entry.

### `DELETE /v1/history/:id`

Deletes a history entry and its associated media file.

```bash
curl -X DELETE http://localhost:3000/v1/history/abc123 \
  -H "Authorization: Bearer $TOKEN"
```

Returns 204 on success, 404 if the entry does not exist.

## Caching

The API server uses a SQLite cache (`~/.summarize/cache.sqlite`) and media cache (`~/.summarize/cache/media/`). Repeated requests for the same URL with the same model/length return cached results without additional LLM or transcription calls.

## Architecture

```
src/server/
  main.ts               — Entry point (Node HTTP server, env/config loading)
  index.ts              — Hono app factory + middleware (logger, auth, static assets)
  middleware/
    auth.ts             — Account-based bearer token validation (timing-safe)
  routes/
    health.ts           — GET /v1/health
    summarize.ts        — POST /v1/summarize (URL, text, extract, SSE streaming)
    history.ts          — GET/DELETE /v1/history
    chat.ts             — POST /v1/chat (follow-up chat on summaries)
    slides.ts           — POST /v1/summarize/:id/slides, GET /v1/slides/:sourceId/:index
    me.ts               — GET /v1/me (current account info)
    default-token.ts    — GET /v1/default-token (anonymous account lookup)
apps/web/               — Preact + Vite frontend (built to dist/, served by API server)
```

The server reuses the existing summarization pipeline (`src/run/`) — no duplicated logic.

## Limitations

- **No rate limiting** — protect with a reverse proxy if exposed publicly.
- **Single process** — no clustering or worker threads.
