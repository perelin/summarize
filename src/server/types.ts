export type ApiLength = "tiny" | "short" | "medium" | "long" | "xlarge";

export type SummarizeJsonBody = {
  url?: string;
  text?: string;
  length?: ApiLength;
  model?: string;
  extract?: boolean;
};

export type SummarizeInsights = {
  // Content
  title: string | null;
  siteName: string | null;
  wordCount: number | null;
  characterCount: number | null;
  truncated: boolean;

  // Media
  mediaDurationSeconds: number | null;
  transcriptSource: string | null;
  transcriptionProvider: string | null;

  // Cache
  cacheStatus: "hit" | "miss" | "expired" | "bypassed" | "fallback" | "unknown" | null;
  summaryFromCache: boolean;

  // Cost
  costUsd: number | null;

  // Tokens (broken out)
  inputTokens: number | null;
  outputTokens: number | null;

  // Extraction
  extractionMethod: string | null;
  servicesUsed: string[];
  attemptedProviders: string[];

  // Timing
  stages: Array<{ stage: string; durationMs: number }>;
};

export type SummarizeResponse = {
  summary: string;
  metadata: {
    title: string | null;
    source: string;
    model: string;
    usage: { inputTokens: number; outputTokens: number } | null;
    durationMs: number;
  };
  insights: SummarizeInsights | null;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};
