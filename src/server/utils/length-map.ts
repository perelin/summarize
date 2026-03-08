import type { ApiLength } from "../types.js";

const LENGTH_MAP: Record<ApiLength, string> = {
  tiny: "400",
  short: "short",
  medium: "medium",
  long: "long",
  xlarge: "xxl",
};

const VALID_LENGTHS = new Set<string>(Object.keys(LENGTH_MAP));

export function mapApiLength(input?: string): string {
  if (!input) return "medium";
  if (!VALID_LENGTHS.has(input)) {
    throw new Error(`Invalid length: ${input}. Must be one of: ${[...VALID_LENGTHS].join(", ")}`);
  }
  return LENGTH_MAP[input as ApiLength];
}
