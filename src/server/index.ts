import { Hono } from "hono";
import { authMiddleware } from "./middleware/auth.js";
import { healthRoute } from "./routes/health.js";
import { createSummarizeRoute, type SummarizeRouteDeps } from "./routes/summarize.js";

export type ServerDeps = SummarizeRouteDeps & {
  apiToken: string | null;
};

export function createApp(deps: ServerDeps) {
  const app = new Hono();

  // Health — no auth
  app.route("/v1", healthRoute);

  // Protected routes
  const summarizeRoute = createSummarizeRoute(deps);
  app.use("/v1/summarize", authMiddleware(deps.apiToken));
  app.route("/v1", summarizeRoute);

  // Global error handler
  app.onError((err, c) => {
    console.error("[summarize-api]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    const isTimeout = message.toLowerCase().includes("timeout");
    return c.json(
      { error: { code: isTimeout ? "TIMEOUT" : "INTERNAL_ERROR", message } },
      isTimeout ? 504 : 500,
    );
  });

  return app;
}
