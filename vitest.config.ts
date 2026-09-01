import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts", "packages/**/src/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "tests/gpu/**", "tests/e2e/**"],
    environment: "node",
    testTimeout: 120_000,
    // One file at a time.
    //
    // The database-backed specs share state that is global by design: there is
    // one `gpu_workers` table answering "what does the fleet have", one row per
    // model in the registry, and one set of routing rules. Running them at once
    // produced exactly what you would expect -- a profile showing up in a fleet
    // a test had just emptied, one spec's signed request reaching another
    // spec's stub worker, and a deadlock between one reserving and another
    // releasing. Making the fleet less global to suit the tests would be the
    // wrong repair; it is global because it is.
    fileParallelism: false,
  },
});
