export type ApiLength = "tiny" | "short" | "medium" | "long" | "xlarge";

export type SummarizeJsonBody = {
  url?: string;
  text?: string;
  length?: ApiLength;
  model?: string;
  extract?: boolean;
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
};

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};
