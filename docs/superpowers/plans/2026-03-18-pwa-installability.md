# PWA Installability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Preact web frontend installable as a PWA via `vite-plugin-pwa`.

**Architecture:** Add `vite-plugin-pwa` to the Vite build, generate PNG icons from the existing SVG favicon, add PWA meta tags to HTML, and update the API server to serve root-level static files (manifest, service worker, icons) instead of returning the SPA shell for all unmatched routes.

**Tech Stack:** vite-plugin-pwa, Workbox (transitive), sharp-cli (icon generation)

**Spec:** `docs/superpowers/specs/2026-03-18-pwa-installability-design.md`

---

## Chunk 1: Icon generation and static assets

### Task 1: Generate PNG icons from favicon.svg

The existing `apps/web/public/favicon.svg` uses light-mode colors (`#c93a1e` background, `#fdfbf7` text). We need to rasterize it to PNGs at three sizes.

**Files:**
- Source: `apps/web/public/favicon.svg`
- Create: `apps/web/public/pwa-192x192.png`
- Create: `apps/web/public/pwa-512x512.png`
- Create: `apps/web/public/apple-touch-icon-180x180.png`

- [ ] **Step 1: Install sharp as a one-time tool and generate icons**

Run:
```bash
cd /Users/sebastianpatinolang/code/p2lab/summarize
npx sharp-cli -i apps/web/public/favicon.svg -o apps/web/public/pwa-512x512.png resize 512 512
npx sharp-cli -i apps/web/public/favicon.svg -o apps/web/public/pwa-192x192.png resize 192 192
npx sharp-cli -i apps/web/public/favicon.svg -o apps/web/public/apple-touch-icon-180x180.png resize 180 180
```

If `sharp-cli` is unavailable or fails on SVG, use `rsvg-convert` (`brew install librsvg`):
```bash
rsvg-convert -w 512 -h 512 apps/web/public/favicon.svg > apps/web/public/pwa-512x512.png
rsvg-convert -w 192 -h 192 apps/web/public/favicon.svg > apps/web/public/pwa-192x192.png
rsvg-convert -w 180 -h 180 apps/web/public/favicon.svg > apps/web/public/apple-touch-icon-180x180.png
```

Note: macOS `sips` does NOT support SVG input — do not use it. The SVG has `prefers-color-scheme` media queries; rasterization will use the default `fill` attributes (light-mode colors: `#c93a1e` bg), which is the desired result.

Expected: Three PNG files in `apps/web/public/`.

- [ ] **Step 2: Verify icons exist and are correct sizes**

Run:
```bash
file apps/web/public/pwa-512x512.png apps/web/public/pwa-192x192.png apps/web/public/apple-touch-icon-180x180.png
```

Expected: Each reported as PNG image data with correct dimensions.

- [ ] **Step 3: Commit icon assets**

```bash
git add apps/web/public/pwa-512x512.png apps/web/public/pwa-192x192.png apps/web/public/apple-touch-icon-180x180.png
git commit -m "feat: add PWA icon assets (192, 512, apple-touch-icon 180)"
```

---

## Chunk 2: vite-plugin-pwa setup

### Task 2: Add vite-plugin-pwa dependency

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install the dependency**

Run:
```bash
cd /Users/sebastianpatinolang/code/p2lab/summarize
pnpm -C apps/web add -D vite-plugin-pwa
```

Expected: `vite-plugin-pwa` added to `devDependencies` in `apps/web/package.json`.

- [ ] **Step 2: Verify installation**

Run:
```bash
pnpm -C apps/web list vite-plugin-pwa
```

Expected: Shows installed version.

### Task 3: Configure VitePWA plugin

**Files:**
- Modify: `apps/web/vite.config.ts`

- [ ] **Step 1: Add VitePWA import and plugin config**

In `apps/web/vite.config.ts`, add the import:

```typescript
import { VitePWA } from "vite-plugin-pwa";
```

Add `VitePWA()` to the `plugins` array:

```typescript
plugins: [
  preact(),
  VitePWA({
    registerType: "autoUpdate",
    manifest: {
      id: "/",
      name: "Summarize_p2",
      short_name: "Summarize_p2",
      description: "Summarize any content with AI",
      theme_color: "#c93a1e",
      background_color: "#f0ebe3",
      display: "standalone",
      scope: "/",
      start_url: "/",
      icons: [
        { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
        { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
        { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    workbox: {
      runtimeCaching: [],
    },
  }),
],
```

- [ ] **Step 2: Verify build succeeds**

Run:
```bash
pnpm -C apps/web build
```

Expected: Build completes. Output in `apps/web/dist/` should include `manifest.webmanifest`, `sw.js`, and `registerSW.js` (or `workbox-*.js`).

- [ ] **Step 3: Verify generated manifest content**

Run:
```bash
cat apps/web/dist/manifest.webmanifest
```

Expected: JSON with `name: "Summarize_p2"`, `theme_color: "#c93a1e"`, icons array, etc.

- [ ] **Step 4: Commit vite-plugin-pwa setup**

```bash
git add apps/web/package.json apps/web/vite.config.ts pnpm-lock.yaml
git commit -m "feat: configure vite-plugin-pwa for PWA installability"
```

### Task 4: Add PWA meta tags to index.html

**Files:**
- Modify: `apps/web/index.html`

- [ ] **Step 1: Add theme-color and apple-touch-icon**

In `apps/web/index.html`, add after the existing `<link rel="icon" ...>` line:

```html
<meta name="theme-color" content="#c93a1e" />
<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" sizes="180x180" />
```

- [ ] **Step 2: Rebuild and verify HTML output**

Run:
```bash
pnpm -C apps/web build && head -20 apps/web/dist/index.html
```

Expected: Output HTML includes the theme-color meta, apple-touch-icon link, and an auto-injected `<link rel="manifest">` tag.

- [ ] **Step 3: Commit HTML changes**

```bash
git add apps/web/index.html
git commit -m "feat: add PWA meta tags (theme-color, apple-touch-icon)"
```

---

## Chunk 3: Server static file handler

### Task 5: Add .webmanifest MIME type and generic static file handler

**Files:**
- Modify: `src/server/index.ts:25-36` (MIME_TYPES map)
- Modify: `src/server/index.ts:85-98` (replace favicon handler)
- Modify: `src/server/index.ts:159-172` (SPA catch-all — keep `/assets/` guard as-is)

- [ ] **Step 1: Write tests for the new static file handler**

In `tests/server.spa.test.ts`, add tests after the existing ones:

```typescript
it("/manifest.webmanifest returns correct content-type, not HTML", async () => {
  const app = createTestApp();
  const res = await app.request("/manifest.webmanifest");
  // Should either serve the file (if built) or 404/503 — never HTML
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 200) {
    expect(contentType).toContain("application/manifest+json");
  }
  // Must not return the SPA shell
  const text = await res.text();
  expect(text).not.toContain("<!doctype html");
});

it("/sw.js returns correct content-type, not HTML", async () => {
  const app = createTestApp();
  const res = await app.request("/sw.js");
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 200) {
    expect(contentType).toContain("application/javascript");
  }
  const text = await res.text();
  expect(text).not.toContain("<!doctype html");
});

it("/pwa-192x192.png returns correct content-type, not HTML", async () => {
  const app = createTestApp();
  const res = await app.request("/pwa-192x192.png");
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 200) {
    expect(contentType).toContain("image/png");
  }
  const text = await res.text();
  expect(text).not.toContain("<!doctype html");
});

it("path traversal attempt does not serve files outside publicDir", async () => {
  const app = createTestApp();
  const res = await app.request("/../package.json");
  const text = await res.text();
  // Must not leak file contents from outside publicDir
  expect(text).not.toContain('"@steipete/summarize');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm vitest run tests/server.spa.test.ts
```

Expected: The new `/manifest.webmanifest` and `/sw.js` tests FAIL because the SPA catch-all currently returns HTML for these paths.

- [ ] **Step 3: Add .webmanifest to MIME_TYPES**

In `src/server/index.ts`, add to the `MIME_TYPES` map:

```typescript
".webmanifest": "application/manifest+json",
```

- [ ] **Step 4: Replace favicon handler with generic static file handler**

In `src/server/index.ts`, replace lines 85-98 (the `/favicon.svg` handler) with:

```typescript
// Serve root-level static files (favicon, PWA manifest, icons, service worker)
// Must come before the SPA catch-all but after all /v1 API routes.
app.get("/*", (c, next) => {
  const reqPath = c.req.path;
  // Skip API routes, /assets/* (handled separately), and root /
  if (reqPath.startsWith("/v1/") || reqPath.startsWith("/assets/") || reqPath === "/")
    return next();
  const filePath = join(publicDir, reqPath);
  if (!filePath.startsWith(publicDir + "/")) return next();
  if (!existsSync(filePath)) return next();

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  const stream = createReadStream(filePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;
  return new Response(webStream, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
});
```

**Important placement:** This handler must go where the old `/favicon.svg` handler was (between the `/` root handler and the `/v1` API routes). It uses `next()` fall-through so API routes and the SPA catch-all still work.

**Keep** the `/assets/` guard in the SPA catch-all — the new generic handler skips `/assets/` paths, so they still reach the catch-all. Without the guard, missing asset requests would get `index.html` instead of 404.

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
pnpm vitest run tests/server.spa.test.ts
```

Expected: All tests pass — existing SPA tests still work, new static file tests pass (or get non-HTML responses for missing files).

- [ ] **Step 6: Run full test suite**

Run:
```bash
pnpm vitest run
```

Expected: All tests pass.

- [ ] **Step 7: Commit server changes**

```bash
git add src/server/index.ts tests/server.spa.test.ts
git commit -m "feat: generic static file handler for PWA assets (manifest, SW, icons)"
```

---

## Chunk 4: Build verification

### Task 6: Full build and verify PWA output

- [ ] **Step 1: Full build**

Run:
```bash
pnpm -s build
```

Expected: Build succeeds. `dist/esm/server/public/` contains `manifest.webmanifest`, `sw.js`, favicon, and PNG icons.

- [ ] **Step 2: Verify PWA files are in server public dir**

Run:
```bash
ls -la dist/esm/server/public/manifest.webmanifest dist/esm/server/public/sw.js dist/esm/server/public/pwa-*.png dist/esm/server/public/apple-touch-icon-*.png
```

Expected: All files present.

- [ ] **Step 3: Run final test suite**

Run:
```bash
pnpm vitest run
```

Expected: All tests pass.
