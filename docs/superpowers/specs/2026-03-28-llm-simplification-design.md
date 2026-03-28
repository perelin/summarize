# LLM System Simplification: Single LiteLLM Gateway

## Problem

The LLM system was designed for CLI use with maximum configurability: 6 native providers, OpenRouter as universal fallback, content-type-based auto-selection with token bands, free-tier routing, and per-provider capability matrices. This complexity is unnecessary for a web service with a single operator. It makes debugging harder, increases maintenance burden, and spreads ~1,900 lines of provider-specific code across the codebase.

## Decision

Replace the entire multi-provider system with a single LiteLLM gateway. All LLM and STT calls go through one endpoint. Model selection is deterministic — one model for text/vision, one for STT.

## Architecture

```
App --> LiteLLM (single endpoint)
         |-- Text/Website/YouTube/PDF --> mistral/mistral-large-latest (256k context)
         |-- Images                   --> mistral/mistral-large-latest (multimodal)
         |-- Chat (follow-ups)        --> mistral/mistral-large-latest
         |-- STT (audio/video)        --> mistral/voxtral-mini-latest
```

- **Default LLM:** `mistral/mistral-large-latest` — 256k context, text + vision
- **Default STT:** `mistral/voxtral-mini-latest` — via LiteLLM `/audio/transcriptions`
- **No fallbacks.** If LiteLLM or the provider is down, the request fails with a clear error.
- **No auto-selection.** No token bands, no content-type rules, no candidate chains.
- **Experimentation:** Change `model` in config to any LiteLLM-supported model ID (e.g. `anthropic/claude-sonnet-4-6`). LiteLLM handles routing.

## New Config Surface

```json
{
  "litellm": {
    "baseUrl": "http://10.10.10.10:4000",
    "apiKey": "optional-key"
  },
  "model": "mistral/mistral-large-latest",
  "sttModel": "mistral/voxtral-mini-latest"
}
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `LITELLM_BASE_URL` | LiteLLM endpoint (default: `http://10.10.10.10:4000`) |
| `LITELLM_API_KEY` | LiteLLM auth key (optional) |
| `SUMMARIZE_MODEL` | Override LLM model for a run |

All provider-specific env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `Z_AI_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`) are removed from the app. API keys live in LiteLLM config only.

Non-LLM keys remain: `FIRECRAWL_API_KEY`, `APIFY_API_TOKEN` (content extraction).

Transcription-specific keys (`GROQ_API_KEY`, `ASSEMBLYAI_API_KEY`, `FAL_KEY`) are removed if STT also goes through LiteLLM. If not all STT providers are available via LiteLLM, keep them as needed.

## Files to Delete (~1,900 lines)

| File | Lines | What it does |
|------|-------|-------------|
| `src/llm/providers/anthropic.ts` | 175 | Anthropic API client |
| `src/llm/providers/openai.ts` | 224 | OpenAI/OpenRouter API client |
| `src/llm/providers/google.ts` | 173 | Google Gemini API client |
| `src/llm/providers/models.ts` | 190 | Per-provider model resolution |
| `src/llm/providers/shared.ts` | 66 | Shared provider utilities |
| `src/llm/providers/types.ts` | 6 | Provider types |
| `src/llm/generate-text.ts` | 898 | 6-provider branching + retry logic |
| `src/llm/provider-capabilities.ts` | 59 | Provider capability matrix |
| `src/run/openrouter.ts` | 80 | OpenRouter API queries |
| `config/default-models.json` | 70 | Auto-rules, token bands, free presets |

## Files to Simplify

### `src/llm/generate-text.ts` (new, ~100-150 lines)

Replace 898-line 6-provider branching with a single OpenAI-compatible client pointing at LiteLLM:

```typescript
import { createOpenAI } from "@ai-sdk/openai";

const client = createOpenAI({
  baseURL: config.litellm.baseUrl,
  apiKey: config.litellm.apiKey,
});
```

Streaming and non-streaming paths remain, but without provider-specific error handling or branching.

### `src/model-auto.ts` (~390 lines) --> Delete

No auto-selection needed. The model is deterministic from config.

### `src/model-spec.ts` (~132 lines) --> Simplify

Remove transport distinction (native vs openrouter), provider-specific base URL overrides. Keep basic model ID validation.

### `src/run/model-attempts.ts` (~76 lines) --> Delete

No fallback chain. One attempt, one result or one error.

### `src/run/run-models.ts` (~125 lines) --> Simplify

Remove named presets, free-model detection, implicit-auto logic. Just resolve: config model or CLI override.

### `src/run/run-env.ts` (~150 lines) --> Simplify

Replace ~12 API keys + base URLs with `LITELLM_BASE_URL` + `LITELLM_API_KEY`. Keep non-LLM keys.

### `src/config/types.ts` (~225 lines) --> Simplify

Delete provider-specific config types (`OpenAiConfig`, `AnthropicConfig`, `GoogleConfig`, `XaiConfig`, `ZaiConfig`, `NvidiaConfig`). Delete `AutoRule`, `AutoRuleKind`, token band types. Add:

```typescript
interface LiteLlmConfig {
  baseUrl: string;
  apiKey?: string;
}
```

### `src/config/default-models.ts` (~102 lines) --> Simplify

No more loading default-models.json with rules and bands. Just export the two default model IDs as constants.

### `src/llm/model-id.ts` (~82 lines) --> Simplify

Remove provider parsing and normalization. Model IDs pass through to LiteLLM as-is.

## Files Unchanged

- **Transcription core** (`src/core/transcription/`, ~3,648 lines) — STT logic is orthogonal. Only the cloud provider configuration changes to use LiteLLM.
- **Pricing** (`src/pricing/litellm.ts`, 62 lines) — stays for cost tracking.
- **Server routes** — minimal changes (fewer env vars to validate).
- **CLI flags** — `--model` override stays, just simpler resolution.
- **Web frontend** — no changes.

## Affected Call Sites (6 files)

These files import from deleted/modified modules and need updating:

1. `src/llm/html-to-markdown.ts` — uses `generateTextWithModelId`
2. `src/llm/transcript-to-markdown.ts` — uses `generateTextWithModelId`
3. `src/run/summary-engine.ts` — uses `streamTextWithModelId`, `ModelAttempt`
4. `src/run/summary-llm.ts` — uses `generateTextWithModelId`
5. `src/server/handlers/upload-image.ts` — uses `streamTextWithModelId`, `LlmApiKeys`
6. `src/summarize/chat.ts` — uses `LlmApiKeys` type

## Net Effect

- **~1,900 lines deleted**
- **~500 lines simplified**
- **~150 lines new** (LiteLLM client wrapper)
- **Config surface:** from ~12 env vars + 6 provider configs to 2 env vars + 1 config block
- **Mental model:** "everything goes through LiteLLM" vs. "which provider, which transport, which fallback"

## Migration / Deployment

1. Ensure LiteLLM on `10.10.10.10:4000` has Mistral configured (API key, model routing)
2. Ensure LiteLLM supports `/audio/transcriptions` for Voxtral
3. Deploy updated app — it only needs `LITELLM_BASE_URL`
4. Remove unused API keys from `.env` / deployment config
5. Update LiteLLM config to add other providers as needed for experimentation

## Open Questions

- **Mistral Large 3 image quality:** Should we do a quick A/B test before committing? The user can test via the existing system before the refactor.
- **STT via LiteLLM:** Need to verify that LiteLLM's `/audio/transcriptions` endpoint works with Voxtral and supports the chunking logic currently in the transcription code (20MB limit per request for Mistral).
