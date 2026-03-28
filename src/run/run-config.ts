import type { SummarizeConfig } from "../config.js";
import { loadSummarizeConfig } from "../config.js";
import { parseVideoMode } from "../flags.js";
import { type OutputLanguage, parseOutputLanguage } from "../language.js";

export type ConfigState = {
  config: SummarizeConfig | null;
  configPath: string | null;
  outputLanguage: OutputLanguage;
  videoMode: ReturnType<typeof parseVideoMode>;
  configModelLabel: string | null;
};

export function resolveConfigState({
  envForRun,
  programOpts,
  languageExplicitlySet,
  videoModeExplicitlySet,
}: {
  envForRun: Record<string, string | undefined>;
  programOpts: Record<string, unknown>;
  languageExplicitlySet: boolean;
  videoModeExplicitlySet: boolean;
}): ConfigState {
  const { config, path: configPath } = loadSummarizeConfig({ env: envForRun });
  const cliLanguageRaw =
    typeof programOpts.language === "string"
      ? (programOpts.language as string)
      : typeof programOpts.lang === "string"
        ? (programOpts.lang as string)
        : null;
  const defaultLanguageRaw = (config?.output?.language ?? config?.language ?? "auto") as string;
  const outputLanguage: OutputLanguage = parseOutputLanguage(
    languageExplicitlySet && typeof cliLanguageRaw === "string" && cliLanguageRaw.trim().length > 0
      ? cliLanguageRaw
      : defaultLanguageRaw,
  );
  const videoMode = parseVideoMode(
    videoModeExplicitlySet
      ? (programOpts.videoMode as string)
      : (config?.media?.videoMode ?? (programOpts.videoMode as string)),
  );

  const configModelLabel = config?.model?.trim() ?? null;

  return {
    config,
    configPath,
    outputLanguage,
    videoMode,
    configModelLabel,
  };
}
