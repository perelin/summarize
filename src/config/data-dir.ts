/**
 * Resolve the application data directory from the environment.
 *
 * The only supported source is the `SUMMARIZE_DATA_DIR` env var.
 * Returns `null` when the variable is unset or empty — callers should
 * treat this as "no data directory configured" and either skip the
 * feature or surface a clear error at startup.
 */
export function resolveDataDir(env: Record<string, string | undefined>): string | null {
  const explicit = env.SUMMARIZE_DATA_DIR?.trim();
  if (explicit && explicit.length > 0) return explicit;
  return null;
}
