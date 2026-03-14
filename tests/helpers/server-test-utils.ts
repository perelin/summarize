import { Hono } from "hono";
import { createSummarizeRoute } from "../../src/server/routes/summarize.js";
import type { SummarizeRouteDeps } from "../../src/server/routes/summarize.js";

/**
 * Base fake dependencies for server test suites. Override individual
 * fields as needed for specific test scenarios.
 */
export function baseFakeDeps(): SummarizeRouteDeps {
  return {
    env: {},
    config: null,
    cache: {
      mode: "bypass",
      store: null,
      ttlMs: 0,
      maxBytes: 0,
      path: null,
    } as any,
    mediaCache: null,
  };
}

/**
 * Create a Hono app with the summarize route mounted at /v1.
 */
export function createTestApp(deps: SummarizeRouteDeps = baseFakeDeps()) {
  const app = new Hono();
  const route = createSummarizeRoute(deps);
  app.route("/v1", route);
  return app;
}
