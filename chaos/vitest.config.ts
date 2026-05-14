import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["chaos/**/*.test.ts"],
    globals: false,
    // Long scenarios (5/6/11) need wall-clock minutes; lift the per-test cap.
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
});
