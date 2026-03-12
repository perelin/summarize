import { describe, expect, it } from "vitest";
import { parseAccountsConfig } from "../src/config/accounts.js";

describe("parseAccountsConfig", () => {
  const path = "/fake/config.json";

  it("returns undefined when accounts key is missing", () => {
    expect(parseAccountsConfig(undefined, path)).toBeUndefined();
  });

  it("throws if accounts is not an array", () => {
    expect(() => parseAccountsConfig("bad", path)).toThrow("must be an array");
  });

  it("throws if accounts is empty", () => {
    expect(() => parseAccountsConfig([], path)).toThrow("at least one account");
  });

  it("throws if name is missing", () => {
    expect(() => parseAccountsConfig([{ token: "a".repeat(32) }], path)).toThrow("name");
  });

  it("throws if token is missing", () => {
    expect(() => parseAccountsConfig([{ name: "alice" }], path)).toThrow("token");
  });

  it("throws if name has invalid characters", () => {
    expect(() => parseAccountsConfig([{ name: "Alice!", token: "a".repeat(32) }], path)).toThrow(
      "lowercase",
    );
  });

  it("throws if token is too short", () => {
    expect(() => parseAccountsConfig([{ name: "alice", token: "short" }], path)).toThrow(
      "32 characters",
    );
  });

  it("throws on duplicate names", () => {
    expect(() =>
      parseAccountsConfig(
        [
          { name: "alice", token: "a".repeat(32) },
          { name: "alice", token: "b".repeat(32) },
        ],
        path,
      ),
    ).toThrow("Duplicate account name");
  });

  it("throws on duplicate tokens", () => {
    const tok = "a".repeat(32);
    expect(() =>
      parseAccountsConfig(
        [
          { name: "alice", token: tok },
          { name: "bob", token: tok },
        ],
        path,
      ),
    ).toThrow("Duplicate token");
  });

  it("parses valid accounts", () => {
    const result = parseAccountsConfig(
      [
        { name: "alice", token: "a".repeat(32) },
        { name: "bob-2", token: "b".repeat(32) },
      ],
      path,
    );
    expect(result).toEqual([
      { name: "alice", token: "a".repeat(32) },
      { name: "bob-2", token: "b".repeat(32) },
    ]);
  });

  it("accepts hyphens in names", () => {
    const result = parseAccountsConfig([{ name: "my-friend-1", token: "x".repeat(32) }], path);
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe("my-friend-1");
  });
});
