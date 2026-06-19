import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Failover + canonical-ordering rigs (qfg-7h5d.1.7). Separate from the
    // single-upstream chaos config because these spawn their own api-delivery
    // upstream(s) (CHAOS_API_BIN) and repoint the primary/secondary/sse proxies.
    include: ["chaos/run-failover-chaos.test.ts"],
    globals: false,
    // Scenarios run wall-clock seconds each, serially per upstream; lift the cap.
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 60 * 1000,
    // One upstream pair at a time — scenarios share fixed proxy ports, so they
    // must not run concurrently.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
