import { resolveConfigState } from "./run-config.js";
import { resolveEnvState } from "./run-env.js";

export function resolveRunContextState({
  env,
  envForRun,
  programOpts,
  languageExplicitlySet,
  videoModeExplicitlySet,
}: {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  programOpts: Record<string, unknown>;
  languageExplicitlySet: boolean;
  videoModeExplicitlySet: boolean;
}) {
  const configState = resolveConfigState({
    envForRun,
    programOpts,
    languageExplicitlySet,
    videoModeExplicitlySet,
  });
  const envState = resolveEnvState({
    env,
    envForRun,
    config: configState.config,
  });
  return { ...configState, ...envState };
}
