export const YT_DLP_PROXY_ENV = "YT_DLP_PROXY";

/**
 * A rejected proxy (quota exhausted, rotated credentials, no tunnel) is an operator problem,
 * not a content problem. Providers swallow yt-dlp failures while they keep trying other rungs
 * (apify, audio transcription), so the failure has to stay recognisable after the fact — both
 * for the API's error classification and for callers that would otherwise report "no
 * transcript available", which hides the real cause behind a content-shaped message.
 */
const PROXY_FAILURE_PATTERN =
  /proxy authentication required|traffic limit|proxyerror|proxy error|unable to connect to proxy|tunnel connection failed/i;

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function isProxyFailure(error: unknown): boolean {
  return PROXY_FAILURE_PATTERN.test(toErrorMessage(error));
}

/** Thrown when the fallback proxy rejected an attempt; carries `PROXY_FAILED` for the API. */
export class MediaProxyError extends Error {
  readonly code = "PROXY_FAILED";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MediaProxyError";
  }
}

export type YtDlpProxyAttempt = {
  /** `direct` connects without a proxy; `proxy` retries through the configured fallback. */
  label: "direct" | "proxy";
  proxyUrl: string | null;
};

/**
 * yt-dlp reads `--proxy` from its config file (`/root/.config/yt-dlp/config`) as well as from
 * the command line. Deployments therefore used to ship a residential proxy globally, which
 * silently turned a paid, quota-limited resource into a hard dependency of *every* download —
 * podcasts and plain media URLs included. When that proxy rejects a request (traffic limit
 * reached, rotated credentials) all transcription stopped, even on URLs that need no proxy.
 *
 * The proxy is a fallback, not the default path: callers always try a direct connection first
 * and pass `--proxy ""` to override whatever the config file set, then retry through
 * `YT_DLP_PROXY` only if the direct attempt failed (bot checks, geo blocks).
 */
export function resolveYtDlpProxyUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env[YT_DLP_PROXY_ENV]?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function buildYtDlpProxyAttempts(proxyUrl: string | null): YtDlpProxyAttempt[] {
  const attempts: YtDlpProxyAttempt[] = [{ label: "direct", proxyUrl: null }];
  if (proxyUrl) attempts.push({ label: "proxy", proxyUrl });
  return attempts;
}

/** yt-dlp treats an empty `--proxy` value as "connect directly". */
export function ytDlpProxyArgs(attempt: YtDlpProxyAttempt): string[] {
  return ["--proxy", attempt.proxyUrl ?? ""];
}

/**
 * Run a yt-dlp operation directly, then once more through the fallback proxy when one is
 * configured and the direct attempt failed. With no proxy configured this is a single attempt
 * and the original error propagates untouched.
 */
export async function runWithYtDlpProxyFallback<T>(options: {
  proxyUrl: string | null;
  /** Human-readable operation name used in fallback notes and combined errors. */
  operation: string;
  run: (proxyArgs: string[]) => Promise<T>;
  /** Clean up partial output before the retry (e.g. a half-written media file). */
  beforeRetry?: () => Promise<void> | void;
  onNote?: (note: string) => void;
}): Promise<T> {
  const attempts = buildYtDlpProxyAttempts(options.proxyUrl);
  const [first] = attempts;
  if (!first || attempts.length === 1) {
    return options.run(ytDlpProxyArgs(first ?? { label: "direct", proxyUrl: null }));
  }

  const failures: string[] = [];
  let lastError: unknown = null;
  let proxyFailure: Error | null = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (!attempt) continue;
    if (index > 0) {
      const previous = attempts[index - 1];
      await options.beforeRetry?.();
      options.onNote?.(
        `${options.operation}: ${previous?.label ?? "direct"} attempt failed; retrying via ${YT_DLP_PROXY_ENV}`,
      );
    }
    try {
      return await options.run(ytDlpProxyArgs(attempt));
    } catch (error) {
      lastError = error;
      if (attempt.label === "proxy" && isProxyFailure(error)) {
        proxyFailure = error instanceof Error ? error : new Error(toErrorMessage(error));
      }
      failures.push(`${attempt.label} attempt failed (${describeError(error)})`);
    }
  }

  const message = failures.join("; ");
  // Report a rejected proxy as such: downstream error classification turns this into
  // PROXY_FAILED instead of the misleading "no transcript available".
  if (proxyFailure) throw new MediaProxyError(message, { cause: proxyFailure });
  throw new Error(message, { cause: lastError });
}

function describeError(error: unknown): string {
  return toErrorMessage(error);
}
