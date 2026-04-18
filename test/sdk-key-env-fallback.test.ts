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

  it("leaves sdkKey empty when neither option nor env set", () => {
    vi.stubEnv("QUONFIG_BACKEND_SDK_KEY", "");
    const q = new Quonfig({} as Parameters<typeof Quonfig>[0]);
    expect((q as unknown as { sdkKey: string }).sdkKey).toBe("");
  });
});
