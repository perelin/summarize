# Discuss in External AI — Design Spec

## Motivation

Summarize is a focused summarization tool. The built-in "chat with source" feature, while functional, dilutes that focus. Purpose-built AI tools (Claude, ChatGPT, Gemini) provide a better conversational experience. Rather than competing with them, Summarize should offer a smooth handoff.

**Primary driver:** Focus — keep the product identity sharp as a summarizer.
**Secondary driver:** Quality — external AI tools provide better chat experiences.

## Approach

Add a "Discuss in..." section above the existing chat panel in the summary detail view. Users click an AI target, choose what content to copy, and get the content on their clipboard + a new tab opened to the AI. The existing chat panel remains unchanged.

This is additive — no features are removed. Chat removal can be evaluated later based on usage.

## UI Component: `DiscussIn`

### Default State

A heading "Discuss in..." followed by a row of 4 styled text pill buttons with distinct colors:

- **Claude** (Anthropic)
- **ChatGPT** (OpenAI)
- **Gemini** (Google)
- **OpenWebUI** (self-hosted, configurable URL)

No brand logo SVGs — text pills avoid trademark concerns and are cleaner.

### Interaction Flow

1. User clicks an AI target pill
2. A small popover appears below with 3 options:
   - "Copy summary"
   - "Copy transcript"
   - "Copy both"
3. Options that aren't available are disabled (e.g. no transcript → "Copy transcript" and "Copy both" greyed out)
4. User selects a content option
5. Content is assembled and copied to clipboard via `navigator.clipboard.writeText()`
6. AI target opens in a new tab via `window.open()`
7. The clicked pill button text briefly changes to "Copied! Paste in chat" (inline feedback, matching existing codebase pattern — no toast infrastructure needed), then reverts after ~2 seconds
8. Popover closes
9. If clipboard write fails (permission denied, page not focused), show inline error text: "Clipboard access denied" — do not open the new tab

**Popover behavior:**

- Dismissed by: clicking outside, pressing Escape, or selecting an option
- Positioned absolutely below the clicked pill
- On small screens: if popover would clip off-viewport, position it centered or above the pill instead

## Clipboard Content Formats

### "Copy summary"

```
I used Summarize to process this content and would like to discuss it with you.

## Summary

{summary text}

Source: {title} ({url or filename})
```

### "Copy transcript"

```
I used Summarize to process this content and would like to discuss it with you.

Here is the original source transcript. Source was {title} ({url or filename}).

## Transcript

{source text}
```

### "Copy both"

```
I used Summarize to process this content and would like to discuss it with you.

## Summary

{summary text}

Here is the original source transcript. Source was {title} ({url or filename}).

## Transcript

{source text}
```

Markdown headings help the receiving AI parse the structure.

### Field Fallbacks

- **Title:** Use the existing `extractDisplayTitle()` fallback chain from `history-view.tsx` (entry.title → insights.title → first markdown heading → first summary line → "Untitled"). Move this to a shared util.
- **Source identifier (`{url or filename}`):** Use `entry.sourceUrl` when available. For uploaded files where `sourceUrl` is null, use "uploaded {sourceType}" (e.g. "uploaded video", "uploaded audio"). If `sourceType` is also unavailable, use "uploaded file".
- **Empty summary:** If `entry.summary` is empty/null (unlikely but possible), disable "Copy summary" and "Copy both" — same pattern as disabled transcript options.

## AI Target URLs

| Target    | URL                             |
| --------- | ------------------------------- |
| Claude    | `https://claude.ai/new`         |
| ChatGPT   | `https://chatgpt.com`           |
| Gemini    | `https://gemini.google.com`     |
| OpenWebUI | Read from localStorage settings |

## Settings Panel

### Storage

- `localStorage` key: `summarize-settings`
- JSON structure, initially just: `{ openWebUiUrl: string | null }`

### UI

- Accessible from a gear icon in the app header/nav
- Minimal panel with one setting for now: **OpenWebUI URL** (text input, placeholder: `http://localhost:3000`)
- Designed to accommodate future settings
- Renders as a modal overlay (simple, works at any screen size, easy to dismiss)

### OpenWebUI Unconfigured Behavior

- Button appears slightly dimmed with a settings badge/indicator
- Clicking opens the settings panel instead of trying to open a blank URL
- Tooltip: "Configure URL in settings"

## Layout in Summary Detail

1. Summary content
2. Metadata bar
3. Media player / slides / transcript toggle
4. **"Discuss in..." section** (new)
5. Chat panel (existing, unchanged)
6. Delete button

## Implementation Scope

### New Files

- `apps/web/src/components/discuss-in.tsx` — main component (pills + popover + clipboard logic)
- `apps/web/src/components/settings-panel.tsx` — minimal settings panel
- `apps/web/src/lib/settings.ts` — localStorage read/write helpers

### Modified Files

- `apps/web/src/components/summary-detail.tsx` — add `DiscussIn` above `ChatPanel`
- `apps/web/src/app.tsx` — add settings gear icon to header

### Explicitly Unchanged

- `ChatPanel` — stays exactly as-is
- All backend code — no server changes
- Chat API endpoints, chat store, chat LLM logic — untouched
- `process-view.tsx` — out of scope (transient state between SSE completion and history entry loading; insufficient metadata for "Discuss in...")
