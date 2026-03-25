# Length Switching Design

Re-summarize an existing summary with a different length preset directly from the summary detail view.

## Design Decisions

- **UI**: Button + dropdown in the action bar (next to Copy/Open), showing current length and all alternatives with approximate char counts
- **Behavior**: Replace — overwrites the existing history entry. Inline SSE streaming replaces the summary text live.
- **Data source**: Uses the stored `transcript` field from the history DB — no re-fetching or re-transcription needed
- **Edge case**: If `transcript` is null, the length-switcher button is hidden

## API

**New endpoint:** `POST /v1/history/:id/resummarize`

Request body:

```json
{ "length": "long" }
```

Behavior:

1. Load history entry by id + account
2. Validate transcript exists
3. Call `streamSummaryForText()` with transcript as input text and new length
4. Stream SSE events (init, status, chunk, meta, metrics, done)
5. On completion, UPDATE the history entry (summary, inputLength, model, metadata, title)

**HistoryStore change:** Add `updateSummary()` method that updates summary-related fields on an existing entry.

## Frontend

**New component:** `LengthSwitcher` — button showing current length + dropdown with all options.

- Placed in action bar, right-aligned (after Copy/Open buttons, with `margin-left: auto`)
- Dropdown items: short, medium, long, xl, xxl — each with approximate char count
- Current length highlighted, disabled
- On selection: calls `resummarizeSSE()`, streams inline, replaces summary text
- During streaming: button shows spinner/loading state, dropdown disabled
- Only rendered when `entry.hasTranscript` is true

**New API function:** `resummarizeSSE(id, length, callbacks)` in `api.ts`

**SummaryDetail changes:**

- Add streaming state (`resummarizing: boolean`, `streamedText: string`)
- When resummarizing, show `streamedText` instead of `entry.summary`
- On done, refresh entry from server to get updated metadata
