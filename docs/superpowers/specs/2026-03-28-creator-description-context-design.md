# Creator Description Context Injection

**Date:** 2026-03-28
**Status:** Approved

## Problem

When summarizing YouTube videos and podcasts that have transcripts, the LLM receives the transcript as primary content but only gets a truncated OG meta description in the `<context>` block. The creator's full description (YouTube's `shortDescription` containing chapters, guest info, topic lists) is already extracted but discarded when a transcript is present. This means the model lacks the creator's own framing of the content, reducing both accuracy (e.g., identifying speakers, credentials) and completeness.

## Solution

Add a `creatorDescription` field to `ExtractedLinkContent` that carries the creator's own description when a richer source than OG tags is already available. Inject it into the prompt's `<context>` block as lightweight background framing — not as primary content.

**Principle:** Use what we already have. No new HTTP requests. No new metadata extraction logic.

## Design

### Data Model

Add `creatorDescription: string | null` to:

- `ExtractedLinkContent` interface
- `FinalizationArguments` interface

**Population rules:**

- **YouTube:** Always capture `extractYouTubeShortDescription(html)`, not just when transcript is null
- **All other sources:** `null` — existing OG description is the best available without extra work

### Prompt Integration

In `buildLinkSummaryPrompt`, accept optional `creatorDescription` parameter. When present and non-empty, add to `<context>` block:

```
Creator's description: <text>
```

Placed after the existing `Page description:` line. Both coexist — OG description is a one-liner, creator's description is the full text.

**Truncation:** Cap at 2000 characters with `…` suffix. YouTube allows up to 5000 chars, but long descriptions are often link dumps that add noise without value.

**No changes to `<instructions>`** — the `<context>` label is sufficient for the model to treat it as background framing rather than authoritative source material.

### Files Changed

| File                                             | Change                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `src/core/content/link-preview/content/types.ts` | Add `creatorDescription: string                                                | null`to`ExtractedLinkContent`and`FinalizationArguments` |
| `src/core/content/link-preview/content/html.ts`  | Always capture `extractYouTubeShortDescription(html)`, pass to finalization    |
| `src/core/content/link-preview/content/utils.ts` | `finalizeExtractedLinkContent` accepts and passes through `creatorDescription` |
| `src/core/prompts/link-summary.ts`               | Accept `creatorDescription`, add to context lines with truncation              |
| `src/run/flows/url/summary-prompt.ts`            | Pass `extracted.creatorDescription` to `buildLinkSummaryPrompt`                |
| Non-YouTube content paths                        | Pass `creatorDescription: null` in finalization args                           |

### Non-YouTube Content Paths

All other call sites of `finalizeExtractedLinkContent` (Spotify, podcasts, direct media, etc.) pass `creatorDescription: null`. The field is inert unless populated. This is extensible — if richer descriptions become easily available for other sources later, they can populate this field without prompt changes.
