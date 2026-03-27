import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import type { ChatStore } from "../chat-store.js";
import type { Account } from "../config.js";
import { authMiddleware } from "./middleware/auth.js";
import { createChatRoute } from "./routes/chat.js";
import { createDefaultTokenRoute } from "./routes/default-token.js";
import { healthRoute } from "./routes/health.js";
import { createHistoryRoute } from "./routes/history.js";
import { createMeRoute } from "./routes/me.js";
import { createResummarizeRoute } from "./routes/resummarize.js";
import { createSharedRoute } from "./routes/shared.js";
import { createSlidesRoute } from "./routes/slides.js";
import { createSummarizeRoute, type SummarizeRouteDeps } from "./routes/summarize.js";
import { SseSessionManager } from "./sse-session.js";

export type ServerDeps = SummarizeRouteDeps & {
  accounts: Account[];
  chatStore?: ChatStore | null;
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildOgDescription(entry: {
  sourceType: string;
  metadata: string | null;
  sourceUrl: string | null;
}): string {
  const parts: string[] = [];

  const typeLabels: Record<string, string> = {
    video: "Video",
    podcast: "Podcast",
    article: "Article",
    text: "Text",
  };
  parts.push(typeLabels[entry.sourceType] ?? "Summary");

  if (entry.metadata) {
    try {
      const meta = JSON.parse(entry.metadata);
      if (typeof meta.mediaDurationSeconds === "number") {
        const m = Math.floor(meta.mediaDurationSeconds / 60);
        parts.push(m > 60 ? `${Math.floor(m / 60)}h ${m % 60}min` : `${m} min`);
      }
      if (typeof meta.wordCount === "number") {
        const wc = meta.wordCount;
        parts.push(
          wc >= 1000 ? `${(wc / 1000).toFixed(1).replace(/\.0$/, "")}k words` : `${wc} words`,
        );
      }
    } catch {
      /* ignore */
    }
  }

  if (entry.sourceUrl) {
    try {
      parts.push(new URL(entry.sourceUrl).hostname.replace(/^www\./, ""));
    } catch {
      /* ignore */
    }
  }

  return parts.join(" · ");
}

function injectOgTags(
  html: string,
  entry: {
    title: string | null;
    sourceType: string;
    sourceUrl: string | null;
    metadata: string | null;
  },
  token: string,
  c: Context,
): string {
  const proto = c.req.header("x-forwarded-proto") ?? "https";
  const host = c.req.header("host") ?? "localhost";
  const baseUrl = `${proto}://${host}`;

  const title = entry.title ?? "Shared Summary";
  const description = buildOgDescription(entry);
  const pageUrl = `${baseUrl}/share/${token}`;
  const imageUrl = `${baseUrl}/v1/shared/${token}/og-image`;

  const tags = [
    `<meta property="og:type" content="article" />`,
    `<meta property="og:title" content="${escHtml(title)}" />`,
    `<meta property="og:description" content="${escHtml(description)}" />`,
    `<meta property="og:url" content="${escHtml(pageUrl)}" />`,
    `<meta property="og:image" content="${escHtml(imageUrl)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:site_name" content="Summarize" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escHtml(title)}" />`,
    `<meta name="twitter:description" content="${escHtml(description)}" />`,
    `<meta name="twitter:image" content="${escHtml(imageUrl)}" />`,
  ].join("\n    ");

  // Also override <title> for shared summaries
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)} — Summarize</title>`);

  // Inject OG tags before </head>
  return html.replace("</head>", `    ${tags}\n  </head>`);
}

export function createApp(deps: ServerDeps) {
  const app = new Hono();
  const sseSessionManager = new SseSessionManager();

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const publicDir = join(__dirname, "public");
  const isDev = process.env.SUMMARIZE_DEV === "1";

  // In dev mode, read static files on each request for instant feedback.
  // In production, read once at startup for performance.
  const indexHtmlPath = join(publicDir, "index.html");
  const indexHtml =
    isDev || !existsSync(indexHtmlPath) ? null : readFileSync(indexHtmlPath, "utf-8");

  // Request/response logging
  app.use(logger((msg) => console.log(`[summarize-api] ${msg}`)));

  // Serve Vite-built static assets (CSS, JS bundles with content hashes)
  app.get("/assets/*", (c) => {
    const filePath = join(publicDir, c.req.path);
    // Prevent path traversal — resolved path must stay within publicDir
    if (!filePath.startsWith(publicDir + "/")) return c.notFound();
    if (!existsSync(filePath)) return c.notFound();

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    const stream = createReadStream(filePath);
    const webStream = Readable.toWeb(stream) as ReadableStream;

    // Hashed filenames are immutable — cache aggressively
    return new Response(webStream, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });

  // Web frontend — no auth
  app.get("/", (c) => {
    if (isDev && existsSync(indexHtmlPath)) {
      return c.html(readFileSync(indexHtmlPath, "utf-8"));
    }
    if (indexHtml) return c.html(indexHtml);
    return c.text("Frontend not built. Run: pnpm -C apps/web build", 503);
  });

  // Serve root-level static files (favicon, PWA manifest, icons, service worker)
  // Uses next() fall-through so API routes and SPA catch-all still work.
  app.get("/*", (c, next) => {
    const reqPath = c.req.path;
    // Skip API routes, /assets/* (handled separately), and root /
    if (reqPath.startsWith("/v1/") || reqPath.startsWith("/assets/") || reqPath === "/")
      return next();
    const filePath = join(publicDir, reqPath);
    if (!filePath.startsWith(publicDir + "/")) return next();
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return next();
    }
    if (!stat.isFile()) return next();

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

  // Health — no auth
  app.route("/v1", healthRoute);

  // Default token — no auth (returns anonymous account token if configured)
  app.route("/v1", createDefaultTokenRoute(deps.accounts));

  // Protected routes - shared auth middleware
  const auth = authMiddleware(deps.accounts);

  // Protected: /v1/me
  app.use("/v1/me", auth);
  app.route("/v1", createMeRoute());

  // Protected: /v1/summarize (POST + GET :id/events reconnection)
  const summarizeRoute = createSummarizeRoute({ ...deps, sseSessionManager });
  app.use("/v1/summarize", auth);
  app.use("/v1/summarize/*", auth);
  app.use("/v1/summarize", bodyLimit({ maxSize: 200 * 1024 * 1024 })); // 200MB (file uploads)
  app.route("/v1", summarizeRoute);

  // History routes (protected)
  if (deps.historyStore) {
    const historyRoute = createHistoryRoute({
      historyStore: deps.historyStore,
      historyMediaPath: deps.historyMediaPath ?? null,
    });
    app.use("/v1/history/*", auth);
    app.use("/v1/history", auth);
    app.route("/v1", historyRoute);

    // Resummarize route (re-summarize with different length)
    const resummarizeRoute = createResummarizeRoute({
      historyStore: deps.historyStore,
      app,
    });
    app.route("/v1", resummarizeRoute);

    // Share routes (POST/DELETE under /v1/history/* are auth'd above;
    // GET /v1/shared/:token is naturally unauthenticated)
    const sharedRoute = createSharedRoute({
      historyStore: deps.historyStore,
      app,
      internalAuthHeader: deps.accounts.length > 0 ? `Bearer ${deps.accounts[0].token}` : undefined,
    });
    app.route("/v1", sharedRoute);
  }

  // Slides routes (protected: POST + GET .../slides/events under /v1/summarize,
  // and GET /v1/slides/:sourceId/:index for serving images)
  const slidesRoute = createSlidesRoute({
    env: deps.env,
    config: deps.config,
    historyStore: deps.historyStore,
    sseSessionManager,
    mediaCache: deps.mediaCache,
  });
  // The POST and events endpoints live under /v1/summarize/* (already auth'd above).
  // The image endpoint /v1/slides/* needs its own auth.
  app.use("/v1/slides/*", auth);
  app.route("/v1", slidesRoute);

  // Chat routes (protected) — requires both history and chat stores
  if (deps.historyStore && deps.chatStore) {
    const chatRoute = createChatRoute({
      env: deps.env,
      config: deps.config,
      historyStore: deps.historyStore,
      chatStore: deps.chatStore,
      sseSessionManager,
    });
    app.use("/v1/chat", auth);
    app.use("/v1/chat/*", auth);
    app.route("/v1", chatRoute);
  }

  // SPA catch-all: serve index.html for any unmatched GET so that
  // client-side routing (e.g. /s/:id, /history) works with direct URLs.
  // For /share/:token paths, inject OG meta tags for social previews.
  // Hono only reaches this handler when no previous route matched.
  app.get("*", (c) => {
    // Let /assets/* fall through to Hono's default 404 — missing static
    // files should not be rewritten to the SPA shell.
    if (c.req.path.startsWith("/assets/")) return c.notFound();

    let html: string | null;
    if (isDev && existsSync(indexHtmlPath)) {
      html = readFileSync(indexHtmlPath, "utf-8");
    } else {
      html = indexHtml;
    }
    if (!html) return c.text("Frontend not built. Run: pnpm -C apps/web build", 503);

    // Inject OG meta tags for shared summary links
    const shareMatch = c.req.path.match(/^\/share\/([A-Za-z0-9_-]{12})$/);
    if (shareMatch && deps.historyStore) {
      const entry = deps.historyStore.getByShareToken(shareMatch[1]);
      if (entry) {
        html = injectOgTags(html, entry, shareMatch[1], c);
      }
    }

    return c.html(html);
  });

  // Global error handler
  app.onError((err, c) => {
    console.error("[summarize-api]", err);
    const isTimeout = err instanceof Error && err.message.toLowerCase().includes("timeout");
    return c.json(
      {
        error: {
          code: isTimeout ? "TIMEOUT" : "INTERNAL_ERROR",
          message: "Internal server error",
        },
      },
      isTimeout ? 504 : 500,
    );
  });

  return app;
}
