# Copy & Open Segmented Button Group

**Date:** 2026-03-20
**Status:** Approved
**Component:** `apps/web/src/components/discuss-in.tsx`

## Problem

The current "Discuss in…" UI has one button per AI service (Claude, ChatGPT, Gemini, OpenWebUI), each opening an identical dropdown with "Copy summary / Copy transcript / Copy both". This is redundant — the copy options are the same regardless of which service you pick.

## Design

Replace the per-service buttons with a **segmented button group** containing two halves:

```
[ Copy… ▾ | Open in… ▾ ]
```

### State management

Single state variable `openDropdown: "copy" | "openin" | null` — the two dropdowns are **mutually exclusive** (opening one closes the other). A separate `showCopyFeedback: boolean` tracks the brief post-copy flash.

Each dropdown gets its own ref (`copyRef`, `openInRef`) for outside-click detection. The `mousedown` handler checks both refs — if the click is outside whichever popover is open, it closes. The toggle buttons use `onClick` which fires after `mousedown`, so the sequence (close via mousedown → re-open via click) produces correct toggle behavior.

### Copy… dropdown

- **Copy summary** — copies formatted summary to clipboard (disabled when `!hasSummary`)
- **Copy transcript** — copies transcript (disabled when `!hasTranscript`)
- **Copy both** — copies both (disabled when `!hasSummary || !hasTranscript`)

On successful copy: left button briefly shows `"✓ Copied ▾"` in green (`#34d399`) for ~1 second, then reverts to `"Copy… ▾"`.

Content format is unchanged — same `buildClipboardContent()` output (header, content, source attribution).

### Open in… dropdown

- **Hint text** at top: _"Copy your summary first"_ (italic, muted) — purely informational, no enforcement
- **Divider**
- **Claude** — colored dot (#d97706), opens https://claude.ai/new
- **ChatGPT** — colored dot (#059669), opens https://chatgpt.com
- **Gemini** — colored dot (#2563eb), opens https://gemini.google.com
- **OpenWebUI** — colored dot (#7c3aed), from settings

Service links are **always active** regardless of clipboard state. Each click opens the URL in a new tab (`_blank`, `noopener`). No clipboard operation.

Colored dots: inline `<span>` with `font-size: 10px`, `margin-right: 8px`, using the Unicode bullet `●` in the service's color.

### OpenWebUI unconfigured state

When `openWebUiUrl` is not set in settings:

- OpenWebUI row appears **dimmed** (50% opacity on the row)
- **Gear icon** (⚙︎, 14px) right-aligned in the row (`margin-left: auto`)
- Clicking opens the settings panel via `open-settings` custom event

### Removed

- Section label "Discuss in…" — dropped, the buttons are self-explanatory
- Per-service color-tinted buttons — replaced by segmented group
- Combined copy+navigate action — fully decoupled
- `feedbackTarget` state (keyed on service name) — replaced by `showCopyFeedback` boolean

## Styling

### Segmented button group

- `display: inline-flex`, `border-radius: 6px`, `overflow: hidden`
- Left button (Copy): text `"Copy… ▾"`, blue tint (`#60a5fa`, 10% background)
- Right button (Open in): text `"Open in… ▾"`, purple tint (`#a78bfa`, 10% background)
- Shared border between buttons (left has no right border, right has full border)
- Font: 12px, weight 600, `var(--font-body)`
- `▾` is part of the button text string

### Dropdowns

- Absolute positioned below their trigger button, `var(--panel)` background, `var(--shadow-md)`, 8px border-radius, 4px padding
- Smart repositioning if clipping viewport edge (reuse existing `useLayoutEffect` logic per dropdown)
- Close on outside click (`mousedown` on document, check against active ref) or Escape
- Items: 13px, full-width, 6px radius, hover background via `transition: background 100ms ease`
- Service rows: `display: flex; align-items: center` for dot + label + optional gear alignment

### Feedback

- Copy success: left button turns green (`#34d399`, background `rgba(52, 211, 153, 0.15)`) with `"✓ Copied ▾"` text for ~1 second, then reverts
- Clipboard error: `var(--error-text)` colored text below the button group ("Clipboard access denied"), 3 seconds

## Scope

Single file change: `apps/web/src/components/discuss-in.tsx`. No new dependencies. Settings integration unchanged.
