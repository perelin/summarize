import { describe, expect, it } from "vitest";

describe("history config types", () => {
  it("SummarizeConfig accepts history section", async () => {
    const config: import("../src/config/types.js").SummarizeConfig = {
      history: {
        enabled: true,
        path: "~/.summarize/history.sqlite",
        mediaPath: "~/.summarize/history/media/",
      },
    };
    expect(config.history?.enabled).toBe(true);
  });
});
