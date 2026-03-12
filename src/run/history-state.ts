import type { SummarizeConfig } from "../config.js";
import {
  createHistoryStore,
  resolveHistoryPath,
  resolveHistoryMediaPath,
  type HistoryStore,
} from "../history.js";

export async function createHistoryStateFromConfig({
  envForRun,
  config,
}: {
  envForRun: Record<string, string | undefined>;
  config: SummarizeConfig | null;
}): Promise<HistoryStore | null> {
  // Check env var override first
  const envEnabled = envForRun.SUMMARIZE_HISTORY_ENABLED?.trim().toLowerCase();
  if (envEnabled === "false" || envEnabled === "0") return null;

  // Check config
  if (config?.history?.enabled === false) return null;

  const historyPath = resolveHistoryPath({
    env: envForRun,
    historyPath: config?.history?.path ?? null,
  });
  if (!historyPath) return null;

  return createHistoryStore({ path: historyPath });
}

export function resolveHistoryMediaPathFromConfig({
  envForRun,
  config,
}: {
  envForRun: Record<string, string | undefined>;
  config: SummarizeConfig | null;
}): string | null {
  return resolveHistoryMediaPath({
    env: envForRun,
    mediaPath: config?.history?.mediaPath ?? null,
  });
}
