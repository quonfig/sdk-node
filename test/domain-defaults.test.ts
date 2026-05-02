import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import type { ConfigEnvelope } from "../src/types";

function emptyEnvelope(): ConfigEnvelope {
  return {
    meta: { version: "test", environment: "Production" },
    configs: [],
  };
}

interface QuonfigInternals {
  apiUrls: string[];
  telemetryUrl?: string;
  transport: { telemetryBaseUrl: string; baseUrls: string[] };
}

function internals(q: Quonfig): QuonfigInternals {
  return q as unknown as QuonfigInternals;
}

describe("QUONFIG_DOMAIN env var derivation", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to prod URLs when QUONFIG_DOMAIN is unset", () => {
    vi.stubEnv("QUONFIG_DOMAIN", "");

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
    });

    const i = internals(q);
    expect(i.apiUrls).toEqual([
      "https://primary.quonfig.com",
      "https://secondary.quonfig.com",
    ]);
    expect(i.transport.telemetryBaseUrl).toBe("https://telemetry.quonfig.com");
    expect(i.transport.baseUrls).toEqual([
      "https://primary.quonfig.com",
      "https://secondary.quonfig.com",
    ]);
  });

  it("derives staging URLs when QUONFIG_DOMAIN=quonfig-staging.com", () => {
    vi.stubEnv("QUONFIG_DOMAIN", "quonfig-staging.com");

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
    });

    const i = internals(q);
    expect(i.apiUrls).toEqual([
      "https://primary.quonfig-staging.com",
      "https://secondary.quonfig-staging.com",
    ]);
    expect(i.transport.telemetryBaseUrl).toBe(
      "https://telemetry.quonfig-staging.com"
    );
  });

  it("explicit telemetryUrl option overrides QUONFIG_DOMAIN", () => {
    vi.stubEnv("QUONFIG_DOMAIN", "quonfig-staging.com");

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      telemetryUrl: "https://telemetry.example.test",
    });

    const i = internals(q);
    // apiUrls still derive from domain
    expect(i.apiUrls).toEqual([
      "https://primary.quonfig-staging.com",
      "https://secondary.quonfig-staging.com",
    ]);
    // telemetryUrl is the explicit override
    expect(i.transport.telemetryBaseUrl).toBe("https://telemetry.example.test");
  });

  it("explicit apiUrls option overrides QUONFIG_DOMAIN", () => {
    vi.stubEnv("QUONFIG_DOMAIN", "quonfig-staging.com");

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      apiUrls: ["http://localhost:8080"],
    });

    const i = internals(q);
    expect(i.apiUrls).toEqual(["http://localhost:8080"]);
    // telemetry still derives from domain (independent resolution)
    expect(i.transport.telemetryBaseUrl).toBe(
      "https://telemetry.quonfig-staging.com"
    );
  });

  it("domain init option flips api + telemetry URLs in lockstep (qfg-ppuc.3)", () => {
    vi.stubEnv("QUONFIG_DOMAIN", "");

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      domain: "quonfig-staging.com",
    });

    const i = internals(q);
    expect(i.apiUrls).toEqual([
      "https://primary.quonfig-staging.com",
      "https://secondary.quonfig-staging.com",
    ]);
    expect(i.transport.telemetryBaseUrl).toBe(
      "https://telemetry.quonfig-staging.com",
    );
  });

  it("domain init option wins over QUONFIG_DOMAIN env var", () => {
    vi.stubEnv("QUONFIG_DOMAIN", "env-should-lose.example");

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      domain: "quonfig-staging.com",
    });

    const i = internals(q);
    expect(i.apiUrls).toEqual([
      "https://primary.quonfig-staging.com",
      "https://secondary.quonfig-staging.com",
    ]);
    expect(i.transport.telemetryBaseUrl).toBe(
      "https://telemetry.quonfig-staging.com",
    );
  });

  it("explicit apiUrls + telemetryUrl still override domain init option", () => {
    vi.stubEnv("QUONFIG_DOMAIN", "");

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      domain: "quonfig-staging.com",
      apiUrls: ["http://localhost:8080"],
      telemetryUrl: "https://telemetry.example.test",
    });

    const i = internals(q);
    expect(i.apiUrls).toEqual(["http://localhost:8080"]);
    expect(i.transport.telemetryBaseUrl).toBe("https://telemetry.example.test");
  });

  it("localhost domain still derives subdomains (no special-casing)", () => {
    vi.stubEnv("QUONFIG_DOMAIN", "");

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      domain: "quonfig.localhost",
    });

    const i = internals(q);
    expect(i.apiUrls).toEqual([
      "https://primary.quonfig.localhost",
      "https://secondary.quonfig.localhost",
    ]);
    expect(i.transport.telemetryBaseUrl).toBe(
      "https://telemetry.quonfig.localhost",
    );
  });

  it("QUONFIG_TELEMETRY_URL env var is no longer honored", () => {
    // Alpha-phase: deleting backward-compat. Setting the old env var must NOT
    // affect resolution; only QUONFIG_DOMAIN + the option are inputs.
    vi.stubEnv("QUONFIG_TELEMETRY_URL", "https://nope.example.test");
    vi.stubEnv("QUONFIG_DOMAIN", "");

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
    });

    expect(internals(q).transport.telemetryBaseUrl).toBe(
      "https://telemetry.quonfig.com"
    );
  });
});
