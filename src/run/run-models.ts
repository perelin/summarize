export type ModelSelection = {
  modelId: string;
  source: "explicit" | "env" | "config" | "default";
};

const DEFAULT_MODEL = "mistral/mistral-large-latest";

export function resolveModelSelection({
  config,
  envForRun,
  explicitModelArg,
}: {
  config: { model?: string } | null;
  envForRun: Record<string, string | undefined>;
  explicitModelArg: string | null;
}): ModelSelection {
  if (explicitModelArg?.trim()) {
    return { modelId: explicitModelArg.trim(), source: "explicit" };
  }
  if (envForRun.SUMMARIZE_MODEL?.trim()) {
    return { modelId: envForRun.SUMMARIZE_MODEL.trim(), source: "env" };
  }
  if (config?.model?.trim()) {
    return { modelId: config.model.trim(), source: "config" };
  }
  return { modelId: DEFAULT_MODEL, source: "default" };
}
