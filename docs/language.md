---
summary: "Output language flag and config options."
read_when:
  - "When changing language handling."
---

# Output language

By default the summary is written in the **same language as the source content** (`language: "auto"`). If language detection is uncertain, it falls back to English.

This affects the language of the generated summary text (not extraction/transcription).

## Language parameter (API)

Pass `language` in the `POST /v1/summarize` body. Supported values (best-effort):

- `auto` (default): match the source language
- Common shorthands: `en`, `de`, `es`, `fr`, ...
- Common names: `english`, `german`/`deutsch`, `spanish`, ...
- BCP-47-ish tags: `en-US`, `pt-BR`, ...
- Free-form hints: `German, formal`

## Config default

Preferred:

```json
{
  "output": { "language": "auto" }
}
```

Legacy (still supported):

```json
{
  "language": "en"
}
```

Unknown values are passed through to the model (sanitized).
