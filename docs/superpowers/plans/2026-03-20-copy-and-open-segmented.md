# Copy & Open Segmented Button Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-service "Discuss in…" buttons with a segmented `[ Copy… ▾ | Open in… ▾ ]` button group that decouples copy from navigation.

**Architecture:** Single-component rewrite of `DiscussIn` in `apps/web/src/components/discuss-in.tsx`. Keep `buildClipboardContent()`, `getAiTargets()`, `CONTENT_OPTIONS`, and `AiTarget`/`ContentOption` types. Replace the render and state management. No new files or dependencies.

**Tech Stack:** Preact, inline styles (matching existing codebase pattern)

**Spec:** `docs/superpowers/specs/2026-03-20-copy-and-open-segmented-design.md`

---

### Task 1: Rewrite state management and event handlers

**Files:**

- Modify: `apps/web/src/components/discuss-in.tsx:63-112`

- [ ] **Step 1: Replace state variables and temporarily stub the return**

Replace the existing state block (lines 63-71) with new state, and replace the entire return block (lines 116-241) with `return null;` so the file compiles during intermediate steps:

```tsx
export function DiscussIn({ entry }: { entry: HistoryDetailEntry }) {
  const [openDropdown, setOpenDropdown] = useState<"copy" | "openin" | null>(null);
  const [showCopyFeedback, setShowCopyFeedback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const openInRef = useRef<HTMLDivElement>(null);
  const title = extractDisplayTitle(entry);
  const hasSummary = Boolean(entry.summary);
  const hasTranscript = Boolean(entry.hasTranscript && entry.transcript);
```

- [ ] **Step 2: Replace the useLayoutEffect for popover repositioning**

Remove the old `useLayoutEffect` (lines 74-78) and the `popoverAlign` state. Replace with a per-dropdown repositioning effect that checks the active dropdown's ref:

```tsx
const [dropdownAlign, setDropdownAlign] = useState<"left" | "right">("left");

useLayoutEffect(() => {
  if (!openDropdown) return;
  const activeRef = openDropdown === "copy" ? copyRef : openInRef;
  if (!activeRef.current) return;
  const rect = activeRef.current.getBoundingClientRect();
  setDropdownAlign(rect.right > window.innerWidth - 8 ? "right" : "left");
}, [openDropdown]);
```

- [ ] **Step 3: Rewrite the outside-click/Escape handler**

Replace the old `useEffect` (lines 81-97). The refs wrap the container divs (button + dropdown together), so `contains()` correctly detects clicks on the trigger button as "inside":

```tsx
useEffect(() => {
  if (!openDropdown) return;
  const handleClick = (e: MouseEvent) => {
    const activeRef = openDropdown === "copy" ? copyRef : openInRef;
    if (activeRef.current && !activeRef.current.contains(e.target as Node)) {
      setOpenDropdown(null);
    }
  };
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setOpenDropdown(null);
  };
  document.addEventListener("mousedown", handleClick);
  document.addEventListener("keydown", handleKey);
  return () => {
    document.removeEventListener("mousedown", handleClick);
    document.removeEventListener("keydown", handleKey);
  };
}, [openDropdown]);
```

- [ ] **Step 4: Replace handleSelect with handleCopy and handleOpenService**

Remove old `handleSelect` (lines 99-112). Add two new handlers:

```tsx
const handleCopy = async (option: ContentOption) => {
  setOpenDropdown(null);
  setError(null);
  try {
    const content = buildClipboardContent(entry, option, title);
    await navigator.clipboard.writeText(content);
    setShowCopyFeedback(true);
    setTimeout(() => setShowCopyFeedback(false), 1000);
  } catch {
    setError("Clipboard access denied");
    setTimeout(() => setError(null), 3000);
  }
};

const handleOpenService = (target: AiTarget) => {
  setOpenDropdown(null);
  if (!target.url) {
    window.dispatchEvent(new CustomEvent("open-settings"));
    return;
  }
  window.open(target.url, "_blank", "noopener");
};
```

- [ ] **Step 5: Verify the file compiles**

Run: `pnpm -C apps/web build`
Expected: Build succeeds. The return block is `return null;` so no JSX references old variables.

---

### Task 2: Rewrite the render JSX

**Files:**

- Modify: `apps/web/src/components/discuss-in.tsx`

**Key structural decision:** Each button+dropdown pair is wrapped in a container `<div>` with `position: relative` and the ref attached to the **container** (not just the dropdown panel). This ensures the outside-click handler's `contains()` check correctly identifies clicks on the trigger button as "inside", so toggle behavior works without stale-closure race conditions.

- [ ] **Step 1: Replace the `return null;` stub with full JSX**

```tsx
const targets = getAiTargets();

return (
  <div style={{ marginTop: "18px" }}>
    {/* Segmented button group */}
    <div style={{ display: "inline-flex", borderRadius: "6px", overflow: "hidden" }}>
      {/* Copy button + dropdown wrapper */}
      <div ref={copyRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpenDropdown(openDropdown === "copy" ? null : "copy")}
          style={{
            padding: "5px 12px",
            fontSize: "12px",
            fontWeight: "600",
            fontFamily: "var(--font-body)",
            color: showCopyFeedback ? "#34d399" : "#60a5fa",
            background: showCopyFeedback ? "rgba(52, 211, 153, 0.15)" : "rgba(96, 165, 250, 0.1)",
            border: `1px solid ${showCopyFeedback ? "rgba(52, 211, 153, 0.25)" : "rgba(96, 165, 250, 0.25)"}`,
            borderRight: "none",
            borderRadius: "6px 0 0 6px",
            cursor: "pointer",
            transition: "all 180ms ease",
          }}
        >
          {showCopyFeedback ? "\u2713 Copied \u25BE" : "Copy\u2026 \u25BE"}
        </button>

        {/* Copy dropdown */}
        {openDropdown === "copy" && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              ...(dropdownAlign === "right" ? { right: 0 } : { left: 0 }),
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
                    if (!disabled) void handleCopy(key);
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

      {/* Open in button + dropdown wrapper */}
      <div ref={openInRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpenDropdown(openDropdown === "openin" ? null : "openin")}
          style={{
            padding: "5px 12px",
            fontSize: "12px",
            fontWeight: "600",
            fontFamily: "var(--font-body)",
            color: "#a78bfa",
            background: "rgba(167, 139, 250, 0.1)",
            border: "1px solid rgba(167, 139, 250, 0.25)",
            borderRadius: "0 6px 6px 0",
            cursor: "pointer",
            transition: "all 180ms ease",
          }}
        >
          Open in&hellip; &#9662;
        </button>

        {/* Open in dropdown */}
        {openDropdown === "openin" && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              ...(dropdownAlign === "right" ? { right: 0 } : { left: 0 }),
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              boxShadow: "var(--shadow-md)",
              padding: "4px",
              zIndex: 5,
              minWidth: "170px",
              animation: "fadeIn 100ms ease",
            }}
          >
            <div
              style={{
                padding: "6px 10px",
                fontSize: "11px",
                color: "var(--muted)",
                fontStyle: "italic",
                fontFamily: "var(--font-body)",
              }}
            >
              Copy your summary first
            </div>
            <div style={{ height: "1px", background: "var(--border)", margin: "4px 0" }} />
            {targets.map((target) => {
              const isUnconfigured = !target.url;
              return (
                <button
                  key={target.name}
                  type="button"
                  onClick={() => handleOpenService(target)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    padding: "6px 10px",
                    fontSize: "13px",
                    fontFamily: "var(--font-body)",
                    color: "var(--text)",
                    background: "transparent",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    textAlign: "left" as const,
                    opacity: isUnconfigured ? 0.5 : 1,
                    transition: "background 100ms ease",
                  }}
                >
                  <span style={{ fontSize: "10px", marginRight: "8px", color: target.color }}>
                    ●
                  </span>
                  {target.name}
                  {isUnconfigured && (
                    <span
                      style={{
                        fontSize: "14px",
                        color: "var(--muted)",
                        marginLeft: "auto",
                        paddingLeft: "10px",
                      }}
                    >
                      ⚙︎
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>

    {/* Error message */}
    {error && (
      <div style={{ marginTop: "6px", fontSize: "12px", color: "var(--error-text)" }}>{error}</div>
    )}
  </div>
);
```

- [ ] **Step 2: Remove unused code**

Remove from the file:

- `hoverColor` field from `AiTarget` type
- `hoverColor` values from each entry in `getAiTargets()` return array

- [ ] **Step 3: Build and verify**

Run: `pnpm -C apps/web build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/discuss-in.tsx
git commit -m "feat: replace per-service buttons with segmented Copy/Open button group"
```

---

### Task 3: Visual verification

**Files:** None (manual testing)

- [ ] **Step 1: Start dev server**

Run: `pnpm -C apps/web dev`

- [ ] **Step 2: Verify default state**

Open http://localhost:5173, navigate to a summary detail. Confirm:

- No "Discuss in…" label
- Segmented button group shows `Copy… ▾` (blue) and `Open in… ▾` (purple)
- Buttons are visually joined with shared border

- [ ] **Step 3: Verify Copy dropdown**

Click `Copy… ▾`. Confirm:

- Dropdown appears below with "Copy summary", "Copy transcript", "Copy both"
- Disabled items appear at low opacity when content is missing
- Clicking an option copies to clipboard, shows green "✓ Copied ▾" for ~1s
- Dropdown closes after selection

- [ ] **Step 4: Verify Open in dropdown**

Click `Open in… ▾`. Confirm:

- Dropdown shows italic hint "Copy your summary first"
- Divider line
- Four services with colored dots (Claude amber, ChatGPT green, Gemini blue, OpenWebUI purple)
- Clicking a service opens it in new tab
- OpenWebUI dropdown aligns under its own button, not the left edge
- If OpenWebUI URL not configured: row is dimmed with gear icon, clicking opens settings

- [ ] **Step 5: Verify mutual exclusion and toggle**

- Open Copy dropdown, then click Open in — confirm Copy closes and Open in opens
- Click the same button again — confirm dropdown toggles closed
- Press Escape — confirm dropdown closes
- Click outside — confirm dropdown closes

- [ ] **Step 6: Run project checks**

Run: `pnpm -s check`
Expected: All checks pass.
