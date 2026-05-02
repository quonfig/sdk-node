import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Quonfig constructor sdkKey requirement", () => {
  it("throws a clear error when sdkKey is empty and no datadir/datafile is provided", () => {
    vi.stubEnv("QUONFIG_BACKEND_SDK_KEY", "");
    expect(() => new Quonfig({})).toThrowError(
      /Quonfig SDK requires an SDK key.*sdkKey: "qf_sk_\.\.\.".*QUONFIG_BACKEND_SDK_KEY.*the option name is sdkKey, not apiKey/s
    );
  });

  it("throws when caller passes apiKey instead of sdkKey (the silent-failure scenario)", () => {
    vi.stubEnv("QUONFIG_BACKEND_SDK_KEY", "");
    expect(
      () =>
        new Quonfig({
          // @ts-expect-error — apiKey is not a valid option; this test captures the
          // exact mistake from the friction log: the SDK used to silently accept this
          // and produce a Basic MTo= 401 downstream.
          apiKey: "qf_sk_development_0044_test",
          domain: "quonfig-staging.com",
          environment: "development",
        })
    ).toThrowError(/the option name is sdkKey, not apiKey/);
  });

  it("does not throw when datadir is provided without sdkKey (Flow A local mode)", () => {
    vi.stubEnv("QUONFIG_BACKEND_SDK_KEY", "");
    expect(
      () =>
        new Quonfig({
          datadir: "/tmp/some-datadir",
          environment: "Production",
        })
    ).not.toThrow();
  });

  it("does not throw when datafile is provided without sdkKey", () => {
    vi.stubEnv("QUONFIG_BACKEND_SDK_KEY", "");
    expect(
      () =>
        new Quonfig({
          datafile: { meta: { version: "v", environment: "Production" }, configs: [] },
          environment: "Production",
        })
    ).not.toThrow();
  });

  it("does not throw when sdkKey comes from QUONFIG_BACKEND_SDK_KEY env var", () => {
    vi.stubEnv("QUONFIG_BACKEND_SDK_KEY", "env-supplied-key");
    expect(() => new Quonfig({})).not.toThrow();
  });
});
