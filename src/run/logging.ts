import { VERBOSE_PREFIX } from "./constants.js";

export function writeVerbose(
  stderr: NodeJS.WritableStream,
  verbose: boolean,
  message: string,
  color: boolean,
  _env?: Record<string, string | undefined>,
): void {
  if (!verbose) {
    return;
  }
  const prefix = color ? `\u001b[36m${VERBOSE_PREFIX}\u001b[0m` : VERBOSE_PREFIX;
  stderr.write(`${prefix} ${message}\n`);
}

export function createRetryLogger({
  stderr,
  verbose,
  color,
  modelId,
  env,
}: {
  stderr: NodeJS.WritableStream;
  verbose: boolean;
  color: boolean;
  modelId: string;
  env?: Record<string, string | undefined>;
}) {
  return (notice: { attempt: number; maxRetries: number; delayMs: number; error?: unknown }) => {
    const message =
      typeof notice.error === "string"
        ? notice.error
        : notice.error instanceof Error
          ? notice.error.message
          : typeof (notice.error as { message?: unknown } | null)?.message === "string"
            ? String((notice.error as { message?: unknown }).message)
            : "";
    const reason = /empty summary/i.test(message)
      ? "empty output"
      : /timed out/i.test(message)
        ? "timeout"
        : "error";
    writeVerbose(
      stderr,
      verbose,
      `LLM ${reason} for ${modelId}; retry ${notice.attempt}/${notice.maxRetries} in ${notice.delayMs}ms.`,
      color,
      env,
    );
  };
}
