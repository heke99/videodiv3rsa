import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts", "packages/**/src/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "tests/gpu/**", "tests/e2e/**"],
    environment: "node",
    testTimeout: 30_000,
  },
});
