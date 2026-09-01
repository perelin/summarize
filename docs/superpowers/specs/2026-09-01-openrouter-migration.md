# Migrate LLM Gateway: LiteLLM → OpenRouter

**Date:** 2026-09-01
**Status:** Implemented

## Summary

Replace the self-hosted LiteLLM gateway (`litellm.p2lab.com` / `10.10.10.10:4000`) with
OpenRouter (`https://openrouter.ai/api/v1`) as the single LLM endpoint for summarize.
One API key, no self-hosted gateway to maintain. STT (Voxtral) is **not** migrated — it
already calls `api.mistral.ai` directly and OpenRouter has no comparable transcription
endpoint with speaker diarization.

## Changes

- **Config:** `litellm: { baseUrl, apiKey }` → `openrouter: { baseUrl?, apiKey? }`.
- **Env:** `LITELLM_BASE_URL` / `LITELLM_API_KEY` → `OPENROUTER_API_KEY` (required for LLM
  calls) and optional `OPENROUTER_BASE_URL`.
- **Defaults** (`src/run/run-env.ts`, single source of truth now — `run-models.ts` imports
  from there): base URL `https://openrouter.ai/api/v1`, model
  `deepseek/deepseek-v4-flash-0731`. STT default unchanged
  (`mistral/voxtral-mini-latest`, direct Mistral API).
- **Types:** `LiteLlmConnection` → `OpenRouterConnection`, `LiteLlmConfig` →
  `OpenRouterConfig` (`src/llm/generate-text.ts`, `src/config/types.ts`).
- **Model picker** (`src/summarize/models.ts`): discovery via OpenRouter `GET /v1/models`
  (same OpenAI-compatible shape, no auth required for listing).
- **Unchanged:** `src/pricing/litellm.ts` — that file wraps tokentally, which loads
  LiteLLM's `model_prices_and_context_window.json` **catalog**. The name is accurate: the
  pricing data source is LiteLLM's catalog, not the gateway.

## Migration steps (ops)

1. API key already exists: `pass show services/summarize/openrouter-key`
   (OpenRouter label `p2_summarizer`, `sk-or-v1-ed7…bd5`, $20/month limit). Local `.env`
   has it set under `OPENROUTER_API_KEY` (done 2026-09-01).
2. Remove `LITELLM_BASE_URL` / `LITELLM_API_KEY` from `.env` (done locally 2026-09-01).
3. `SUMMARIZE_MODEL=deepseek/deepseek-v4-flash-0731` replaces the mistral-large default.
4. After deploy: `./scripts/deploy-env.sh` syncs the key to the server (the
   `*_BASE_URL` skip pattern no longer matches anything relevant). Restart the container.
   Old `LITELLM_*` vars on the remote are ignored by the new code and can be deleted.
5. The LiteLLM gateway stays up — other p2lab services (mail-sorter, justlisten,
   immo_scanner) still use it.

## Smoke test (2026-09-01, key sk-or-v1-ed7…bd5)

`POST https://openrouter.ai/api/v1/chat/completions` with
`deepseek/deepseek-v4-flash-0731` returns clean completions (`finish_reason: stop`,
content "OK"). Note: **the model is a reasoning model** — it emits ~40 reasoning tokens
before visible text (OpenRouter reports them in
`usage.completion_tokens_details.reasoning_tokens`). Keep `maxOutputTokens` at
reasonable levels; with tiny budgets the answer is consumed by reasoning
(`finish_reason: "length"` with empty content). pi-ai's text extraction is unaffected —
reasoning arrives as a separate field and is ignored.

## Risks / Notes

- OpenRouter requires `Authorization: Bearer <key>` — pi-ai's OpenAI-compatible client
  already sends that (key is shimmed into `OPENAI_API_KEY` for pi-ai).
- Optional OpenRouter headers (`HTTP-Referer`, `X-Title`) are not set; not required.
- OpenRouter model IDs sometimes resolve to different upstream providers per request;
  response shape stays OpenAI-compatible, so the pi-ai path is unaffected.
- `contextWindow: 256_000` / `maxTokens: 16_384` in `createOpenRouterModel` remain
  heuristic client-side values; OpenRouter enforces real limits.
