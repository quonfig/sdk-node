import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Single-upstream chaos suite only. The failover + ordering rigs have their
    // own config (vitest.failover.config.ts) because they spawn their own
    // api-delivery upstream(s) and need CHAOS_API_BIN.
    include: ["chaos/run-chaos.test.ts"],
    globals: false,
    // Long scenarios (5/6/11) need wall-clock minutes; lift the per-test cap.
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
});
