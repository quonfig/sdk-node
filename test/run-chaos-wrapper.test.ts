import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const wrapperPath = join(__dirname, "..", "scripts", "run-chaos.sh");

describe("scripts/run-chaos.sh (qfg-mzg2)", () => {
  it("exists and is executable", () => {
    const stats = statSync(wrapperPath);
    expect(stats.isFile()).toBe(true);
    // 0o111 = any execute bit set
    expect(stats.mode & 0o111).not.toBe(0);
  });

  it("parses as valid bash", () => {
    expect(() =>
      execSync(`bash -n ${JSON.stringify(wrapperPath)}`, { stdio: "pipe" })
    ).not.toThrow();
  });

  it("delegates to the shared chaos harness and api-delivery boot", () => {
    const src = readFileSync(wrapperPath, "utf8");

    // Boot mechanism: shared toxiproxy launcher + api-delivery build/run.
    expect(src).toMatch(/integration-test-data\/chaos/);
    expect(src).toMatch(/start-chaos\.sh/);
    expect(src).toMatch(/api-delivery/);
    expect(src).toMatch(/go build .* \.\/cmd\/server/);

    // Healthz wait so the proxy never points at a not-yet-listening backend.
    expect(src).toMatch(/healthz/);

    // Lock attribution so a concurrent SDK chaos run is detectable.
    expect(src).toMatch(/QUONFIG_CHAOS_SESSION/);
    expect(src).toMatch(/QUONFIG_CHAOS_OWNER_PID/);

    // Cleanup on EXIT so a failure mid-test still tears down the stack.
    expect(src).toMatch(/trap .*cleanup.* EXIT/);
    expect(src).toMatch(/stop-chaos\.sh/);

    // Hand-off to the language runner: CHAOS_API_DELIVERY_URL exported, then
    // `npm run chaos` invoked. If these regressed the wrapper would still
    // boot toxiproxy but the SDK would never know which upstream to hit.
    expect(src).toMatch(/CHAOS_API_DELIVERY_URL=/);
    expect(src).toMatch(/npm run chaos/);
  });
});
