# Summarize Web Service API — Design Document

**Date:** 2026-03-08
**Status:** Approved (POC / Dogfooding)

## Context

The summarize project already has a local HTTP daemon (`src/daemon/`) built for the browser extension using SSE streaming and native Node.js `http`. We want a separate, simpler HTTP API for scripts and automation: POST content in, get a summary back as JSON. This is a POC for dogfooding before considering productization.

## Constraints

- Synchronous request/response only (no SSE, no job queues)
- Single bearer token auth (env var)
- Docker deployment
- Reuse existing core library, LLM, and config code — don't duplicate logic
- Cloud transcription only (Mistral Voxtral) — no whisper-cpp in Docker image

## API Contract

### `POST /v1/summarize`

Three input modes:

**URL (JSON):**

```json
{ "url": "https://example.com/article", "length": "short", "model": "anthropic/claude-sonnet-4" }
```

**Text (JSON):**

```json
{ "text": "Long article content...", "length": "medium" }
```

**File upload (multipart/form-data):**

```
file=@podcast.mp3, length=long, model=anthropic/claude-sonnet-4
```

**Parameters** (all optional except one of url/text/file):

| Param     | Default        | Values                                      |
| --------- | -------------- | ------------------------------------------- |
| `length`  | `medium`       | `tiny`, `short`, `medium`, `long`, `xlarge` |
| `model`   | config default | any supported model ID                      |
| `extract` | `false`        | `true` = content only, no LLM summary       |

**Response (200):**

```json
{
  "summary": "Markdown summary...",
  "metadata": {
    "title": "Article Title",
    "source": "https://example.com/article",
    "model": "anthropic/claude-sonnet-4",
    "usage": { "inputTokens": 1234, "outputTokens": 567 },
    "durationMs": 3400
  }
}
```

**Errors:**

```json
{ "error": { "code": "INVALID_INPUT", "message": "Must provide url, text, or file" } }
```

Status codes: 400, 401, 413, 500, 504.

### `GET /v1/health`

Returns `{"status": "ok"}`. No auth required.

### Authentication

`Authorization: Bearer <token>` — token set via `SUMMARIZE_API_TOKEN` env var.

## Architecture

```
src/server/
  index.ts              — Hono app factory + middleware
  main.ts               — Entry point (starts Node HTTP server)
  types.ts              — Request/response types
  middleware/
    auth.ts             — Bearer token validation
  routes/
    health.ts           — GET /v1/health
    summarize.ts        — POST /v1/summarize (URL, text, file)
  utils/
    length-map.ts       — API length names → core length names
```

### Reused existing code (no modifications):

| Module                       | What for                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `src/daemon/summarize.ts`    | `streamSummaryForUrl()`, `streamSummaryForVisiblePage()`, `extractContentForUrl()` |
| `src/daemon/flow-context.ts` | `createDaemonUrlFlowContext()` — wires LLM, config, cache, metrics                 |
| `packages/core`              | Content extraction, prompt builders, transcription providers                       |
| `src/llm/generate-text.ts`   | LLM calls                                                                          |
| `src/config.ts`              | Config loading                                                                     |
| `src/content/asset.ts`       | File/asset loading                                                                 |

### New transcription provider:

Mistral Voxtral added to `packages/core/src/transcription/whisper/` — follows the exact pattern of `groq.ts` (55 lines). Endpoint: `POST https://api.mistral.ai/v1/audio/transcriptions`, model `voxtral-mini-latest`.

### New dependencies:

- `hono` (~14KB) — HTTP framework
- `@hono/node-server` — Node.js adapter

## Docker

Multi-stage build:

1. **Builder:** node:22-slim + pnpm → compile TypeScript
2. **Runtime:** node:22-slim + ffmpeg + yt-dlp → run server

No whisper-cpp. Cloud transcription via Mistral Voxtral.

**Env vars at runtime:**

```
SUMMARIZE_API_TOKEN=<required>
SUMMARIZE_API_PORT=3000
MISTRAL_API_KEY=<for transcription>
ANTHROPIC_API_KEY=<at least one LLM key>
OPENAI_API_KEY=<optional>
GEMINI_API_KEY=<optional>
```

## Key Design Decisions

1. **Separate server, not bolted onto daemon** — the daemon is tightly coupled to browser extension concerns (SSE sessions, slide serving, extension CORS). A clean Hono server avoids that baggage.
2. **Sync only** — simplest possible API. If timeouts become an issue during dogfooding, async can be added later.
3. **No CORS** — this is for scripts/automation, not browsers.
4. **No rate limiting** — POC scope. Easy to add via Hono middleware later.
5. **Length mapping:** `tiny`→400 chars, `short`→`short`, `medium`→`medium`, `long`→`long`, `xlarge`→`xxl`.
6. **Mistral Voxtral for transcription** — purpose-built STT, placed after AssemblyAI in the provider fallback chain.

## Known Footguns

- **LLM API keys on server** — leaked bearer token = leaked API keys
- **Long requests** — podcast transcription + summarization can take >2 min; reverse proxies may timeout
- **Memory** — large file uploads + transcription in one process without backpressure
- **No rate limiting** — runaway script can burn API credits

## Future Opportunities

- Caching (same URL → same summary, saves API cost)
- Batch endpoint (N URLs in one call)
- Webhook/async fallback for long jobs
- Web UI frontend
- Multi-model A/B comparison
