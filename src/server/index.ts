import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import type { Account } from "../config.js";
import { authMiddleware } from "./middleware/auth.js";
import { healthRoute } from "./routes/health.js";
import { createHistoryRoute } from "./routes/history.js";
import { createMeRoute } from "./routes/me.js";
import { createSummarizeRoute, type SummarizeRouteDeps } from "./routes/summarize.js";

export type ServerDeps = SummarizeRouteDeps & {
  accounts: Account[];
};

export function createApp(deps: ServerDeps) {
  const app = new Hono();

  // Read index HTML once at startup
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const indexHtml = readFileSync(join(__dirname, "public", "index.html"), "utf-8");

  // Request/response logging
  app.use(logger((msg) => console.log(`[summarize-api] ${msg}`)));

  // Web frontend — no auth
  app.get("/", (c) => c.html(indexHtml));

  // Health — no auth
  app.route("/v1", healthRoute);

  // Protected routes - shared auth middleware
  const auth = authMiddleware(deps.accounts);

  // Protected: /v1/me
  app.use("/v1/me", auth);
  app.route("/v1", createMeRoute());

  // Protected: /v1/summarize
  const summarizeRoute = createSummarizeRoute(deps);
  app.use("/v1/summarize", auth);
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

  // Global error handler
  app.onError((err, c) => {
    console.error("[summarize-api]", err);
    const isTimeout = err instanceof Error && err.message.toLowerCase().includes("timeout");
    return c.json(
      {
        error: { code: isTimeout ? "TIMEOUT" : "INTERNAL_ERROR", message: "Internal server error" },
      },
      isTimeout ? 504 : 500,
    );
  });

  return app;
}
