import { serve } from "@hono/node-server";
import { loadSummarizeConfig } from "../config.js";
import { createCacheStateFromConfig } from "../run/cache-state.js";
import {
  createHistoryStateFromConfig,
  resolveHistoryMediaPathFromConfig,
} from "../run/history-state.js";
import { createMediaCacheFromConfig } from "../run/media-cache-state.js";
import { createApp } from "./index.js";

const env = { ...process.env };
const port = Number(env.SUMMARIZE_API_PORT) || 3000;

// Deprecation warning for old single-token env var
if (env.SUMMARIZE_API_TOKEN) {
  console.warn(
    "[summarize-api] SUMMARIZE_API_TOKEN is deprecated and ignored. Use accounts config instead.",
  );
}

const { config } = loadSummarizeConfig({ env });

// Require accounts config
if (!config?.accounts || config.accounts.length === 0) {
  console.error(
    "[summarize-api] No accounts configured. Add an 'accounts' array to ~/.summarize/config.json.",
  );
  console.error("[summarize-api] Example:");
  console.error(
    '[summarize-api]   "accounts": [{ "name": "myname", "token": "<32+ char token>" }]',
  );
  process.exit(1);
}

const accounts = config.accounts;
console.log(
  `[summarize-api] ${accounts.length} account(s) configured: ${accounts.map((a) => a.name).join(", ")}`,
);

const cache = await createCacheStateFromConfig({ envForRun: env, config, noCacheFlag: false });
const mediaCache = await createMediaCacheFromConfig({ envForRun: env, config });
const historyStore = await createHistoryStateFromConfig({ envForRun: env, config });
const historyMediaPath = resolveHistoryMediaPathFromConfig({ envForRun: env, config });

const app = createApp({ env, config, cache, mediaCache, accounts, historyStore, historyMediaPath });

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
