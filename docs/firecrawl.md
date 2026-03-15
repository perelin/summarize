---
summary: "Firecrawl fallback modes and API key usage."
read_when:
  - "When changing Firecrawl behavior."
---

# Firecrawl mode

Firecrawl is a fallback for sites that block direct HTML fetching or don’t render meaningful content without JS.

## Firecrawl mode (`firecrawl` API parameter)

Values: `off`, `auto` (default), `always`

- `off`: never use Firecrawl.
- `auto`: use Firecrawl only when HTML extraction looks blocked/thin.
- `always`: try Firecrawl first (falls back to HTML if Firecrawl is unavailable/empty).

## API key

- `FIRECRAWL_API_KEY` (required for Firecrawl requests)
