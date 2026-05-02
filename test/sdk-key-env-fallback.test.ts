import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Quonfig sdkKey env var fallback", () => {
  it("uses explicit options.sdkKey when provided (takes precedence over env)", () => {
    vi.stubEnv("QUONFIG_BACKEND_SDK_KEY", "env-key");
    const q = new Quonfig({ sdkKey: "explicit-key" });
    expect((q as unknown as { sdkKey: string }).sdkKey).toBe("explicit-key");
  });

  it("falls back to QUONFIG_BACKEND_SDK_KEY env var when sdkKey not passed", () => {
    vi.stubEnv("QUONFIG_BACKEND_SDK_KEY", "env-key");
    const q = new Quonfig({} as Parameters<typeof Quonfig>[0]);
    expect((q as unknown as { sdkKey: string }).sdkKey).toBe("env-key");
  });

  it("throws when neither option nor env set (and no datadir/datafile)", () => {
    vi.stubEnv("QUONFIG_BACKEND_SDK_KEY", "");
    expect(() => new Quonfig({} as Parameters<typeof Quonfig>[0])).toThrowError(
      /Quonfig SDK requires an SDK key/
    );
  });
});
