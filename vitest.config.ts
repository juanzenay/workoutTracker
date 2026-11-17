import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    // Builds the migrated template database once per run.
    globalSetup: ["tests/db/global-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
