import type { Account } from "./types.js";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MIN_TOKEN_LENGTH = 32;

export function parseAccountsConfig(raw: unknown, configPath: string): Account[] | undefined {
  if (raw === undefined) return undefined;

  if (!Array.isArray(raw)) {
    throw new Error(`Invalid config file ${configPath}: "accounts" must be an array`);
  }

  if (raw.length === 0) {
    throw new Error(
      `Invalid config file ${configPath}: "accounts" must contain at least one account`,
    );
  }

  const names = new Set<string>();
  const tokens = new Set<string>();
  const accounts: Account[] = [];

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    const prefix = `Invalid config file ${configPath}: accounts[${i}]`;

    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${prefix} must be an object`);
    }

    const record = entry as Record<string, unknown>;
    const name = record.name;
    const token = record.token;

    if (typeof name !== "string" || !name.trim()) {
      throw new Error(`${prefix}: "name" is required and must be a non-empty string`);
    }

    if (typeof token !== "string" || !token.trim()) {
      throw new Error(`${prefix}: "token" is required and must be a non-empty string`);
    }

    const trimmedName = name.trim();
    const trimmedToken = token.trim();

    if (!NAME_PATTERN.test(trimmedName)) {
      throw new Error(
        `${prefix}: "name" must be lowercase alphanumeric with hyphens (got "${trimmedName}")`,
      );
    }

    if (trimmedToken.length < MIN_TOKEN_LENGTH) {
      throw new Error(
        `${prefix}: "token" must be at least ${MIN_TOKEN_LENGTH} characters (got ${trimmedToken.length})`,
      );
    }

    if (names.has(trimmedName)) {
      throw new Error(`Invalid config file ${configPath}: Duplicate account name "${trimmedName}"`);
    }

    if (tokens.has(trimmedToken)) {
      throw new Error(
        `Invalid config file ${configPath}: Duplicate token found for account "${trimmedName}"`,
      );
    }

    names.add(trimmedName);
    tokens.add(trimmedToken);
    accounts.push({ name: trimmedName, token: trimmedToken });
  }

  return accounts;
}
