import { createReadStream, existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import type { ChatStore } from "../chat-store.js";
import type { Account } from "../config.js";
import { authMiddleware } from "./middleware/auth.js";
import { healthRoute } from "./routes/health.js";
import { createChatRoute } from "./routes/chat.js";
import { createHistoryRoute } from "./routes/history.js";
import { createMeRoute } from "./routes/me.js";
import { createSlidesRoute } from "./routes/slides.js";
import {
  createSummarizeRoute,
  type SummarizeRouteDeps,
} from "./routes/summarize.js";
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
};

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
    isDev || !existsSync(indexHtmlPath)
      ? null
      : readFileSync(indexHtmlPath, "utf-8");

  // Request/response logging
  app.use(logger((msg) => console.log(`[summarize-api] ${msg}`)));

  // Serve Vite-built static assets (CSS, JS bundles with content hashes)
  app.get("/assets/*", (c) => {
    const filePath = join(publicDir, c.req.path);
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

  // Favicon
  app.get("/favicon.svg", (c) => {
    const filePath = join(publicDir, "favicon.svg");
    if (isDev && existsSync(filePath)) {
      const svg = readFileSync(filePath, "utf-8");
      return c.body(svg, 200, { "Content-Type": "image/svg+xml" });
    }
    if (existsSync(filePath)) {
      const svg = readFileSync(filePath, "utf-8");
      c.header("Cache-Control", "public, max-age=86400");
      return c.body(svg, 200, { "Content-Type": "image/svg+xml" });
    }
    return c.notFound();
  });

  // Health — no auth
  app.route("/v1", healthRoute);

  // Protected routes - shared auth middleware
  const auth = authMiddleware(deps.accounts);

  // Protected: /v1/me
  app.use("/v1/me", auth);
  app.route("/v1", createMeRoute());

  // Protected: /v1/summarize (POST + GET :id/events reconnection)
  const summarizeRoute = createSummarizeRoute({ ...deps, sseSessionManager });
  app.use("/v1/summarize", auth);
  app.use("/v1/summarize/*", auth);
  app.use("/v1/summarize", bodyLimit({ maxSize: 10 * 1024 * 1024 })); // 10MB
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
  // Hono only reaches this handler when no previous route matched.
  app.get("*", (c) => {
    // Let /assets/* fall through to Hono's default 404 — missing static
    // files should not be rewritten to the SPA shell.
    if (c.req.path.startsWith("/assets/")) return c.notFound();

    if (isDev && existsSync(indexHtmlPath)) {
      return c.html(readFileSync(indexHtmlPath, "utf-8"));
    }
    if (indexHtml) return c.html(indexHtml);
    return c.text("Frontend not built. Run: pnpm -C apps/web build", 503);
  });

  // Global error handler
  app.onError((err, c) => {
    console.error("[summarize-api]", err);
    const isTimeout =
      err instanceof Error && err.message.toLowerCase().includes("timeout");
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
