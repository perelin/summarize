import { cpus } from "node:os";
import { defineConfig } from "vitest/config";

const cpuCount = Math.max(1, cpus().length);
const envMaxThreads = Number.parseInt(process.env.VITEST_MAX_THREADS ?? "", 10);
const maxThreads = Number.isFinite(envMaxThreads)
  ? envMaxThreads
  : Math.min(8, Math.max(4, Math.floor(cpuCount / 2)));
const coverageReporters = process.env.CI
  ? ["text", "json-summary", "html"]
  : ["text", "json-summary"];

export default defineConfig({
  poolOptions: {
    threads: {
      minThreads: 1,
      maxThreads,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: coverageReporters,
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/dist/**",
        "**/node_modules/**",
        "tests/**",
        // Slide extraction is integration-tested; unit coverage is too noisy.
        "src/slides/extract.ts",
        // OS/browser integration (exec/sqlite/keychain); covered via higher-level tests.
        "**/src/content/transcript/providers/twitter-cookies-*.ts",
        // Barrels / type-only entrypoints (noise for coverage).
        "src/**/index.ts",
        "src/**/types.ts",
        "src/**/deps.ts",
      ],
      thresholds: {
        // Raised after full dead-code sweep (Chunks 1-6).
        branches: 59,
        functions: 73,
        lines: 71,
        statements: 69,
      },
    },
  },
});
