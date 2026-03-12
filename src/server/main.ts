import { serve } from "@hono/node-server";
import { loadSummarizeConfig } from "../config.js";
import { createCacheStateFromConfig } from "../run/cache-state.js";
import { createMediaCacheFromConfig } from "../run/media-cache-state.js";
import { createHistoryStateFromConfig, resolveHistoryMediaPathFromConfig } from "../run/history-state.js";
import { createApp } from "./index.js";

const env = { ...process.env };
const port = Number(env.SUMMARIZE_API_PORT) || 3000;
const apiToken = env.SUMMARIZE_API_TOKEN?.trim() || null;

if (!apiToken) {
  console.error("[summarize-api] SUMMARIZE_API_TOKEN is required.");
  process.exit(1);
}

const { config } = loadSummarizeConfig({ env });
const cache = await createCacheStateFromConfig({ envForRun: env, config, noCacheFlag: false });
const mediaCache = await createMediaCacheFromConfig({ envForRun: env, config });
const historyStore = await createHistoryStateFromConfig({ envForRun: env, config });
const historyMediaPath = resolveHistoryMediaPathFromConfig({ envForRun: env, config });

const app = createApp({ env, config, cache, mediaCache, apiToken, historyStore, historyMediaPath });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[summarize-api] Listening on http://0.0.0.0:${info.port}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[summarize-api] ${signal} received, shutting down...`);
    historyStore?.close();
    server.close(() => process.exit(0));
    setTimeout(() => {
      console.error("[summarize-api] Forced shutdown after timeout");
      process.exit(1);
    }, 30_000).unref();
  });
}
