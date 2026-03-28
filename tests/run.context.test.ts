import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRunContextState } from "../src/run/run-context.js";

describe("run context state", () => {
  it("combines config + env resolution", () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-context-"));
    writeFileSync(
      join(root, "config.json"),
      JSON.stringify({
        model: "openai/gpt-5-mini",
        litellm: { baseUrl: "http://localhost:4000" },
      }),
      "utf8",
    );

    const env = {
      SUMMARIZE_DATA_DIR: root,
    };

    const state = resolveRunContextState({
      env,
      envForRun: env,
      programOpts: { videoMode: "auto" },
      languageExplicitlySet: false,
      videoModeExplicitlySet: false,
    });

    expect(state.configModelLabel).toBe("openai/gpt-5-mini");
    expect(state.model).toBe("openai/gpt-5-mini");
    expect(state.litellmBaseUrl).toBe("http://localhost:4000");
  });
});
