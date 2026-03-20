# Discuss in External AI — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Discuss in..." section to the summary detail view that copies summary/transcript content to clipboard and opens an external AI (Claude, ChatGPT, Gemini, OpenWebUI) in a new tab.

**Architecture:** Purely frontend feature — no backend changes. A new `DiscussIn` component renders above the existing `ChatPanel`. A minimal settings panel (modal overlay) stores OpenWebUI URL in localStorage. A shared `extractDisplayTitle` util is extracted from `history-view.tsx` for reuse.

**Tech Stack:** Preact, inline styles with CSS custom properties (matching existing codebase), `navigator.clipboard` API, localStorage.

---

## Chunk 1: Shared Utilities & Settings Infrastructure

### Task 1: Extract `extractDisplayTitle` to shared util

**Files:**

- Create: `apps/web/src/lib/display-title.ts`
- Modify: `apps/web/src/components/history-view.tsx:47-73`

- [ ] **Step 1: Create the shared util**

Create `apps/web/src/lib/display-title.ts`:

```typescript
import type { HistoryEntry } from "./api.js";

/** Extract a display title: entry.title -> insights title -> first summary heading -> first summary line -> fallback */
export function extractDisplayTitle(
  entry: Pick<HistoryEntry, "title" | "metadata" | "summary">,
): string {
  if (entry.title) return entry.title;

  if (entry.metadata) {
    try {
      const insights = JSON.parse(entry.metadata);
      if (insights?.title) return insights.title;
    } catch {
      /* ignore */
    }
  }

  if (entry.summary) {
    const match = entry.summary.match(/^#+\s+(.+)$/m);
    if (match) return match[1].trim();
    const firstLine = entry.summary
      .split("\n")
      .find((l) => l.trim())
      ?.trim();
    if (firstLine) {
      const cleaned = firstLine.replace(/^[#*_`]+\s*/, "").replace(/[*_`]+$/g, "");
      if (cleaned) return cleaned.length > 80 ? cleaned.slice(0, 77) + "\u2026" : cleaned;
    }
  }

  return "Untitled";
}
```

- [ ] **Step 2: Update `history-view.tsx` to import from shared util**

Replace the local `extractDisplayTitle` function (lines 46-73) with:

```typescript
import { extractDisplayTitle } from "../lib/display-title.js";
```

Remove the local function definition entirely.

- [ ] **Step 3: Verify the app still works**

Run: `pnpm -C apps/web build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/display-title.ts apps/web/src/components/history-view.tsx
git commit -m "refactor: extract extractDisplayTitle to shared util"
```

### Task 2: Create settings localStorage helpers

**Files:**

- Create: `apps/web/src/lib/settings.ts`

- [ ] **Step 1: Create the settings module**

Create `apps/web/src/lib/settings.ts`:

```typescript
const STORAGE_KEY = "summarize-settings";

export type Settings = {
  openWebUiUrl: string | null;
};

const DEFAULTS: Settings = {
  openWebUiUrl: null,
};

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function updateSettings(patch: Partial<Settings>): void {
  const current = getSettings();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/settings.ts
git commit -m "feat: add localStorage settings helpers"
```

### Task 3: Create settings panel component

**Files:**

- Create: `apps/web/src/components/settings-panel.tsx`

- [ ] **Step 1: Create the settings panel modal**

Create `apps/web/src/components/settings-panel.tsx`:

```tsx
import { useEffect, useRef, useState } from "preact/hooks";
import { getSettings, updateSettings } from "../lib/settings.js";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [openWebUiUrl, setOpenWebUiUrl] = useState(() => getSettings().openWebUiUrl ?? "");
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSave = () => {
    updateSettings({ openWebUiUrl: openWebUiUrl.trim() || null });
    onClose();
  };

  return (
    <div
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
        animation: "fadeIn 150ms ease",
      }}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "24px",
          width: "min(400px, calc(100vw - 32px))",
          boxShadow: "var(--shadow-md)",
        }}
      >
        <h2
          style={{
            fontSize: "16px",
            fontWeight: "600",
            fontFamily: "var(--font-body)",
            color: "var(--text)",
            marginBottom: "16px",
          }}
        >
          Settings
        </h2>

        <label
          style={{
            display: "block",
            fontSize: "13px",
            fontWeight: "500",
            color: "var(--text)",
            marginBottom: "6px",
          }}
        >
          OpenWebUI URL
        </label>
        <input
          type="url"
          value={openWebUiUrl}
          onInput={(e) => setOpenWebUiUrl((e.target as HTMLInputElement).value)}
          placeholder="http://localhost:3000"
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: "14px",
            fontFamily: "var(--font-body)",
            background: "var(--field-bg)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            color: "var(--text)",
            outline: "none",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
        />
        <p
          style={{
            fontSize: "12px",
            color: "var(--muted)",
            marginTop: "4px",
          }}
        >
          Base URL for your self-hosted OpenWebUI instance.
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "20px" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 14px",
              fontSize: "13px",
              fontWeight: "500",
              fontFamily: "var(--font-body)",
              color: "var(--muted)",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: "6px 14px",
              fontSize: "13px",
              fontWeight: "700",
              fontFamily: "var(--font-body)",
              color: "var(--accent-text)",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm -C apps/web build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/settings-panel.tsx
git commit -m "feat: add settings panel modal component"
```

### Task 4: Add settings gear icon to app header

**Files:**

- Modify: `apps/web/src/app.tsx:87-114`

- [ ] **Step 1: Add settings state and gear button**

In `apps/web/src/app.tsx`:

1. Add import at top:

```typescript
import { SettingsPanel } from "./components/settings-panel.js";
```

2. Add state inside the `App` component (after existing state declarations around line 16):

```typescript
const [showSettings, setShowSettings] = useState(false);
```

3. Insert the gear button after `<ThemeToggle />` (after line 113), inside the flex container:

```tsx
<button
  type="button"
  onClick={() => setShowSettings(true)}
  title="Settings"
  style={{
    padding: "4px 10px",
    fontSize: "12px",
    fontWeight: "500",
    fontFamily: "var(--font-body)",
    color: "var(--muted)",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "color 150ms ease, border-color 150ms ease",
  }}
>
  ⚙
</button>
```

4. Render the settings panel conditionally before the closing `</div>` of the container (before line 143):

```tsx
{
  showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />;
}
```

- [ ] **Step 2: Verify build and test visually**

Run: `pnpm -C apps/web build`
Expected: Build succeeds. Gear icon visible in header next to theme toggle.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app.tsx
git commit -m "feat: add settings gear icon to app header"
```

---

## Chunk 2: DiscussIn Component & Integration

### Task 5: Create the DiscussIn component

**Files:**

- Create: `apps/web/src/components/discuss-in.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/discuss-in.tsx`:

```tsx
import { useEffect, useRef, useState } from "preact/hooks";
import type { HistoryDetailEntry } from "../lib/api.js";
import { extractDisplayTitle } from "../lib/display-title.js";
import { getSettings } from "../lib/settings.js";

type ContentOption = "summary" | "transcript" | "both";

type AiTarget = {
  name: string;
  url: string | null;
  color: string;
  hoverColor: string;
};

function getAiTargets(): AiTarget[] {
  const settings = getSettings();
  return [
    { name: "Claude", url: "https://claude.ai/new", color: "#d97706", hoverColor: "#b45309" },
    { name: "ChatGPT", url: "https://chatgpt.com", color: "#059669", hoverColor: "#047857" },
    { name: "Gemini", url: "https://gemini.google.com", color: "#2563eb", hoverColor: "#1d4ed8" },
    { name: "OpenWebUI", url: settings.openWebUiUrl, color: "#7c3aed", hoverColor: "#6d28d9" },
  ];
}

function buildClipboardContent(
  entry: HistoryDetailEntry,
  option: ContentOption,
  title: string,
): string {
  const sourceId = entry.sourceUrl ?? `uploaded ${entry.sourceType || "file"}`;
  const parts: string[] = [
    "I used Summarize to process this content and would like to discuss it with you.",
    "",
  ];

  if (option === "summary" || option === "both") {
    parts.push("## Summary", "", entry.summary || "", "");
  }

  if (option === "transcript" || option === "both") {
    parts.push(
      `Here is the original source transcript. Source was ${title} (${sourceId}).`,
      "",
      "## Transcript",
      "",
      entry.transcript || "",
    );
  }

  if (option === "summary") {
    parts.push(`Source: ${title} (${sourceId})`);
  }

  return parts.join("\n");
}

const CONTENT_OPTIONS: { key: ContentOption; label: string }[] = [
  { key: "summary", label: "Copy summary" },
  { key: "transcript", label: "Copy transcript" },
  { key: "both", label: "Copy both" },
];

export function DiscussIn({ entry }: { entry: HistoryDetailEntry }) {
  const [openTarget, setOpenTarget] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const title = extractDisplayTitle(entry);
  const hasSummary = Boolean(entry.summary);
  const hasTranscript = Boolean(entry.hasTranscript && entry.transcript);

  // Close popover on outside click or Escape
  useEffect(() => {
    if (!openTarget) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenTarget(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenTarget(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openTarget]);

  const handleSelect = async (target: AiTarget, option: ContentOption) => {
    setOpenTarget(null);
    setError(null);
    try {
      const content = buildClipboardContent(entry, option, title);
      await navigator.clipboard.writeText(content);
      window.open(target.url!, "_blank", "noopener");
      setFeedbackTarget(target.name);
      setTimeout(() => setFeedbackTarget(null), 2000);
    } catch {
      setError("Clipboard access denied");
      setTimeout(() => setError(null), 3000);
    }
  };

  const targets = getAiTargets();

  return (
    <div style={{ marginTop: "18px" }}>
      <div
        style={{
          fontSize: "12px",
          fontWeight: "500",
          color: "var(--muted)",
          marginBottom: "8px",
          fontFamily: "var(--font-body)",
        }}
      >
        Discuss in\u2026
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", position: "relative" }}>
        {targets.map((target) => {
          const isUnconfigured = !target.url;
          const isFeedback = feedbackTarget === target.name;
          return (
            <div key={target.name} style={{ position: "relative" }}>
              <button
                type="button"
                title={isUnconfigured ? "Configure URL in settings" : `Discuss in ${target.name}`}
                onClick={() => {
                  if (isUnconfigured) {
                    // Open settings — dispatch custom event that app.tsx listens for
                    window.dispatchEvent(new CustomEvent("open-settings"));
                    return;
                  }
                  setOpenTarget(openTarget === target.name ? null : target.name);
                }}
                style={{
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: "600",
                  fontFamily: "var(--font-body)",
                  color: isFeedback
                    ? "var(--accent-text)"
                    : isUnconfigured
                      ? "var(--muted)"
                      : target.color,
                  background: isFeedback
                    ? "var(--accent)"
                    : isUnconfigured
                      ? "var(--surface)"
                      : `color-mix(in srgb, ${target.color} 10%, var(--surface))`,
                  border: `1px solid ${isFeedback ? "var(--accent)" : isUnconfigured ? "var(--border)" : `color-mix(in srgb, ${target.color} 25%, var(--border))`}`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  transition: "all 180ms ease",
                  opacity: isUnconfigured ? 0.6 : 1,
                }}
              >
                {isFeedback ? "Copied! Paste in chat" : target.name}
                {isUnconfigured && !isFeedback && " ⚙"}
              </button>

              {/* Popover */}
              {openTarget === target.name && (
                <div
                  ref={popoverRef}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    boxShadow: "var(--shadow-md)",
                    padding: "4px",
                    zIndex: 5,
                    minWidth: "150px",
                    animation: "fadeIn 100ms ease",
                  }}
                >
                  {CONTENT_OPTIONS.map(({ key, label }) => {
                    const disabled =
                      (key === "summary" && !hasSummary) ||
                      (key === "transcript" && !hasTranscript) ||
                      (key === "both" && (!hasSummary || !hasTranscript));
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (!disabled) void handleSelect(target, key);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "6px 10px",
                          fontSize: "13px",
                          fontFamily: "var(--font-body)",
                          color: disabled ? "var(--muted)" : "var(--text)",
                          background: "transparent",
                          border: "none",
                          borderRadius: "6px",
                          cursor: disabled ? "not-allowed" : "pointer",
                          textAlign: "left" as const,
                          opacity: disabled ? 0.4 : 1,
                          transition: "background 100ms ease",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <div
          style={{
            marginTop: "6px",
            fontSize: "12px",
            color: "var(--error-text)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm -C apps/web build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/discuss-in.tsx
git commit -m "feat: add DiscussIn component for external AI handoff"
```

### Task 6: Integrate DiscussIn into summary-detail

**Files:**

- Modify: `apps/web/src/components/summary-detail.tsx:11,152-155`

- [ ] **Step 1: Add import and render DiscussIn above ChatPanel**

In `apps/web/src/components/summary-detail.tsx`:

1. Add import at top (after line 11):

```typescript
import { DiscussIn } from "./discuss-in.js";
```

2. Insert `<DiscussIn entry={entry} />` before `<ChatPanel summaryId={id} />` (before line 155):

```tsx
{
  /* Discuss in external AI */
}
<DiscussIn entry={entry} />;

{
  /* Chat */
}
<ChatPanel summaryId={id} />;
```

- [ ] **Step 2: Verify build**

Run: `pnpm -C apps/web build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/summary-detail.tsx
git commit -m "feat: integrate DiscussIn section into summary detail view"
```

### Task 7: Wire up open-settings event from DiscussIn to App

**Files:**

- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Listen for the custom `open-settings` event**

In `apps/web/src/app.tsx`, add a `useEffect` after the existing auth `useEffect` (after line 42):

```typescript
useEffect(() => {
  const handler = () => setShowSettings(true);
  window.addEventListener("open-settings", handler);
  return () => window.removeEventListener("open-settings", handler);
}, []);
```

- [ ] **Step 2: Verify build and full flow**

Run: `pnpm -C apps/web build`
Expected: Build succeeds. The full flow works:

- Summary detail shows "Discuss in..." section above chat
- Clicking Claude/ChatGPT/Gemini shows popover with content options
- Clicking OpenWebUI (unconfigured) opens settings modal
- Settings modal saves URL to localStorage

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app.tsx
git commit -m "feat: wire open-settings event for unconfigured OpenWebUI button"
```

---

## Chunk 3: Build, Test & Deploy

### Task 8: Run full build and checks

- [ ] **Step 1: Run full project build**

Run: `pnpm -s build`
Expected: Build succeeds.

- [ ] **Step 2: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass. (No new tests needed — feature is purely UI with no new API surface.)

- [ ] **Step 3: Run check gate**

Run: `pnpm -s check`
Expected: All checks pass (formatting, types, tests).

- [ ] **Step 4: Commit any formatting fixes if needed**

```bash
git add -A
git commit -m "style: fix formatting"
```

### Task 9: Deploy to production

- [ ] **Step 1: Deploy via task**

Run: `task deploy`

This bumps version, runs checks, creates a GitHub Release which triggers the deploy Action.

- [ ] **Step 2: Verify deployment**

Check that the new version is live at `summarize.p2lab.com` — open a summary, verify the "Discuss in..." section appears above the chat panel.
