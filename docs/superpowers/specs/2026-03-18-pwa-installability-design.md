# PWA Installability for Summarize_p2 Web Frontend

**Date:** 2026-03-18
**Status:** Approved
**Scope:** Installability only (no offline caching, no background sync)

## Goal

Make the Preact web frontend (`apps/web`) installable as a PWA so users can add it to their home screen and run it in a standalone window with proper app identity (icon, name, theme color, splash screen).

## Decisions

- **Approach:** `vite-plugin-pwa` — proven, well-maintained Vite integration
- **Name:** "Summarize_p2" (both `name` and `short_name`)
- **Theme color:** `#c93a1e` (accent red)
- **Background color:** `#f0ebe3` (warm light background)
- **Display mode:** `standalone`
- **Service worker:** Auto-update, minimal — only needed to satisfy browser install prompt requirements. No runtime caching.

## Changes

### 1. New dependency

`vite-plugin-pwa` added as a dev dependency to `apps/web/package.json`.

### 2. Vite config (`apps/web/vite.config.ts`)

Add `VitePWA()` plugin with:

```typescript
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
});
```

Note: `navigateFallback` is intentionally omitted — with no precaching, Workbox would have no cached `index.html` to serve, causing runtime errors. The browser handles navigation normally.

### 3. Icon assets (new files in `apps/web/public/`)

Generated from existing `favicon.svg`:

| File                           | Size    | Purpose                                |
| ------------------------------ | ------- | -------------------------------------- |
| `pwa-192x192.png`              | 192x192 | Android home screen icon               |
| `pwa-512x512.png`              | 512x512 | Android splash screen / install dialog |
| `apple-touch-icon-180x180.png` | 180x180 | iOS home screen icon                   |

### 4. HTML meta tags (`apps/web/index.html`)

Add to `<head>`:

```html
<meta name="theme-color" content="#c93a1e" />
<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" sizes="180x180" />
```

The `<link rel="manifest">` tag is auto-injected by the plugin.

### 5. Server static file handler (`src/server/index.ts`)

The SPA catch-all (`app.get("*")`) currently returns `index.html` for all unmatched routes. This means requests for `/sw.js`, `/manifest.webmanifest`, and PNG icons would get HTML instead of their actual content, silently breaking PWA installability.

**Fix:** Replace the hardcoded `/favicon.svg` handler with a generic root-level static file handler that runs before the SPA catch-all. It checks if the requested path maps to an existing file in `publicDir` and serves it with the correct MIME type. Only files directly in `publicDir` (not subdirectories, which are handled by `/assets/*`) are matched. This also future-proofs serving any new static files without code changes.

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

The existing `MIME_TYPES` map already includes `.json`, `.png`, and `.js` entries. Add `.webmanifest`:

```typescript
".webmanifest": "application/manifest+json",
```

The hardcoded `/favicon.svg` route can be removed — the generic handler covers it.

## What this does NOT include

- No offline page or offline fallback
- No API response caching
- No push notifications
- No background sync
- No changes to frontend application code (only server static file handling)

## Testing

- Chrome DevTools > Application > Manifest: verify manifest loads correctly
- Chrome DevTools > Application > Service Workers: verify SW registers
- Lighthouse PWA audit: verify "Installable" criteria pass
- Mobile: verify "Add to Home Screen" prompt appears
