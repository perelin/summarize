# Web Frontend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a minimal web frontend to the summarize API server so users can summarize URLs/text from a browser.

**Architecture:** Single static HTML file served by the existing Hono server at `GET /`. Token auth via `?token=` query param. Vanilla HTML/CSS/JS with `marked` from CDN for markdown rendering. No build step, no new npm deps.

**Tech Stack:** Hono (existing), vanilla HTML/CSS/JS, marked.js (CDN)

---

### Task 1: Add static HTML route to Hono server

**Files:**

- Create: `src/server/public/index.html` (placeholder)
- Modify: `src/server/index.ts:1-39`
- Test: `tests/server.frontend.test.ts`

**Step 1: Write the failing test**

Create `tests/server.frontend.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/index.js";

const deps = {
  env: {},
  config: null,
  cache: { get: async () => null, set: async () => {} } as any,
  mediaCache: null,
  apiToken: "test-token",
};

describe("GET /", () => {
  it("serves HTML without authentication", async () => {
    const app = createApp(deps);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("contains the page title", async () => {
    const app = createApp(deps);
    const res = await app.request("/");
    const body = await res.text();
    expect(body).toContain("<title>");
    expect(body).toContain("Summarize");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server.frontend.test.ts`
Expected: FAIL — `GET /` returns 404

**Step 3: Create placeholder HTML file**

Create `src/server/public/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Summarize</title>
  </head>
  <body>
    <h1>Summarize</h1>
  </body>
</html>
```

**Step 4: Add route to serve the HTML**

In `src/server/index.ts`, add a `GET /` route before the health route. Read the HTML file at app creation time using `fs.readFileSync` (the file is small and only read once at startup). Use `path.join` with `import.meta.url` to resolve the file path relative to the module.

```typescript
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// At the top of createApp():
const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(__dirname, "public", "index.html"), "utf-8");

// Route (before health, no auth):
app.get("/", (c) => c.html(indexHtml));
```

**Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/server.frontend.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat(server): serve web frontend HTML at GET /
```

---

### Task 2: Build the complete frontend HTML

**Files:**

- Modify: `src/server/public/index.html`

**Step 1: Write the full HTML file**

The single HTML file contains all CSS and JS inline. Key sections:

**CSS:**

- System font stack, max-width container (~700px), centered
- Clean typography for rendered markdown (headings, lists, code, blockquotes)
- Tab-style toggle for URL vs Text input
- Pulsing dot animation for the loading indicator
- Responsive — works on mobile

**HTML structure:**

- Auth warning banner (hidden when token present)
- Input form with URL/Text tabs, length dropdown, submit button
- Loading indicator (hidden by default): pulsing dot + "Summarizing... (Xs)"
- Result container (hidden by default): rendered markdown + metadata footer
- Error container (hidden by default)

**JS (inline `<script>`):**

- On load: read `?token=` from URL, show/hide auth warning
- Tab switching: toggle between URL input and Text textarea
- On form submit:
  - Build JSON body from form state (`{url, length}` or `{text, length}`)
  - Show loading indicator, start elapsed timer (`setInterval` every 1s)
  - `fetch('/v1/summarize', { method: 'POST', headers: { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' }, body })`
  - On success: parse response, render `marked.parse(data.summary)` into result div, show metadata
  - On error: show error message from response body or network error
  - On complete: hide loading indicator, clear timer

**External dependency:**

- `<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>`

**Step 2: Manually test in browser**

Run the server locally and open `http://localhost:3000/?token=<your-token>` to verify:

- Page loads with clean layout
- Auth warning shows/hides correctly
- Tab switching works
- Submitting a URL shows spinner, then rendered result
- Error states display properly

**Step 3: Commit**

```
feat(server): implement web frontend with URL/text input and markdown rendering
```

---

### Task 3: Add frontend test coverage

**Files:**

- Modify: `tests/server.frontend.test.ts`

**Step 1: Add content tests**

Extend the test file with tests that verify the HTML contains the key UI elements:

```typescript
describe("GET / — UI elements", () => {
  it("includes the URL input", async () => {
    const app = createApp(deps);
    const res = await app.request("/");
    const body = await res.text();
    expect(body).toContain('id="url-input"');
  });

  it("includes the text input", async () => {
    const app = createApp(deps);
    const res = await app.request("/");
    const body = await res.text();
    expect(body).toContain('id="text-input"');
  });

  it("includes the length selector", async () => {
    const app = createApp(deps);
    const res = await app.request("/");
    const body = await res.text();
    expect(body).toContain('id="length-select"');
  });

  it("includes the marked.js CDN script", async () => {
    const app = createApp(deps);
    const res = await app.request("/");
    const body = await res.text();
    expect(body).toContain("marked");
  });
});
```

**Step 2: Run all server tests**

Run: `pnpm vitest run tests/server.*.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```
test(server): add frontend HTML content tests
```

---

### Task 4: Update documentation

**Files:**

- Modify: `docs/api-server.md`

**Step 1: Add web frontend section to API docs**

Add a section after "Quick start" in `docs/api-server.md`:

```markdown
## Web frontend

The server includes a built-in web UI at the root URL:
```

http://localhost:3000/?token=your-secret-token

```

Features:
- Summarize URLs or paste text directly
- Choose summary length (tiny/short/medium/long/xlarge)
- Rendered markdown output with metadata (model, duration, tokens)

The token is passed as a query parameter — bookmark the URL for quick access.
```

**Step 2: Commit**

```
docs: add web frontend section to API server docs
```
