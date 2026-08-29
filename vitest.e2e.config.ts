import { defineConfig } from "vitest/config";

/**
 * End-to-end runs separately from the unit suite: it builds and starts real
 * servers, so it is slow and must not run in parallel with anything.
 */
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.spec.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
