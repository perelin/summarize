import { readFileSync } from "node:fs";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const rootPkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));

export default defineConfig({
  plugins: [preact()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:3000",
    },
  },
});
