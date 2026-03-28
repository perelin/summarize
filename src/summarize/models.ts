import type { SummarizeConfig } from "../config.js";
import type { LiteLlmConnection } from "../llm/generate-text.js";
import { resolveEnvState } from "../run/run-env.js";

export type ModelPickerOption = {
  id: string;
  label: string;
};

function uniqById(options: ModelPickerOption[]): ModelPickerOption[] {
  const seen = new Set<string>();
  const out: ModelPickerOption[] = [];
  for (const opt of options) {
    const id = opt.id.trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: opt.label.trim() || id });
  }
  return out;
}

async function discoverLiteLlmModelIds({
  connection,
  fetchImpl,
  timeoutMs,
}: {
  connection: LiteLlmConnection;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<string[]> {
  const base = connection.baseUrl.endsWith("/") ? connection.baseUrl : `${connection.baseUrl}/`;
  const modelsUrl = new URL("models", base).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (connection.apiKey) {
      headers.authorization = `Bearer ${connection.apiKey}`;
    }
    const res = await fetchImpl(modelsUrl, {
      method: "GET",
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    if (!json || typeof json !== "object") return [];

    const obj = json as Record<string, unknown>;
    const data = obj.data;
    if (Array.isArray(data)) {
      const ids = data
        .map((item) => (item && typeof item === "object" ? (item as { id?: unknown }).id : null))
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim());
      return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
    }

    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildModelPickerOptions({
  env,
  envForRun,
  config,
  fetchImpl,
}: {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  config: SummarizeConfig | null;
  fetchImpl: typeof fetch;
}): Promise<{
  ok: true;
  options: ModelPickerOption[];
  currentModel: string;
  litellmBaseUrl: string;
}> {
  const envState = resolveEnvState({ env, envForRun, config });

  const connection: LiteLlmConnection = {
    baseUrl: envState.litellmBaseUrl,
    apiKey: envState.litellmApiKey,
  };

  const options: ModelPickerOption[] = [];

  // Add the configured default model first
  options.push({ id: envState.model, label: `Default: ${envState.model}` });

  // Discover available models from LiteLLM gateway
  const discovered = await discoverLiteLlmModelIds({
    connection,
    fetchImpl,
    timeoutMs: 2000,
  });
  for (const id of discovered) {
    options.push({ id, label: id });
  }

  return {
    ok: true,
    options: uniqById(options),
    currentModel: envState.model,
    litellmBaseUrl: envState.litellmBaseUrl,
  };
}
