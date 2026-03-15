---
summary: "Manual end-to-end test checklist for model and input coverage."
read_when:
  - "When doing release validation."
---

# Manual tests

Goal: sanity-check auto selection + presets end-to-end via the API.

## Setup

- `OPENAI_API_KEY=...` (optional)
- `ASSEMBLYAI_API_KEY=...` (optional)
- `GEMINI_API_KEY=...` (optional)
- `ANTHROPIC_API_KEY=...` (optional)
- `XAI_API_KEY=...` (optional)
- `OPENROUTER_API_KEY=...` (optional)
- `Z_AI_API_KEY=...` (optional)

## Auto (default)

- Website summary (should pick a model automatically):
  - POST `/v1/summarize` with `{“url”: “https://example.com”, “length”: “short”}`
- Missing-key skip (configure only one key; should skip other providers, still succeed):
  - Set only `OPENAI_API_KEY`, then run a website summary; should not try Gemini/Anthropic/XAI.
- AssemblyAI transcript path:
  - Set only `ASSEMBLYAI_API_KEY`, then summarize a podcast URL; `transcriptionProvider` should report `assemblyai`.

## Presets

- Define a preset in `~/.summarize/config.json` (see README -- “Configuration”), then:
  - POST `/v1/summarize` with `{“url”: “https://example.com”, “model”: “<preset>”, “length”: “short”}`
  - If the preset contains OpenRouter models, ensure `OPENROUTER_API_KEY` is set.

## Video

- YouTube:
  - POST `/v1/summarize` with `{“url”: “https://www.youtube.com/watch?v=dQw4w9WgXcQ”, “length”: “short”}`

## Z.AI

- POST `/v1/summarize` with `{“url”: “https://example.com”, “model”: “zai/glm-4.7”, “length”: “short”}`
