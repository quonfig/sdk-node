import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let homedirMock: () => string = () => "/nonexistent-default";
vi.mock("os", async () => {
  const actual = await vi.importActual<typeof import("os")>("os");
  return {
    ...actual,
    homedir: () => homedirMock(),
  };
});

import { Quonfig } from "../src/quonfig";
import { tokenFilenameForApiUrls } from "../src/devContext";
import type { ConfigEnvelope } from "../src/types";

function emptyEnvelope(): ConfigEnvelope {
  return {
    meta: { version: "test", environment: "Production" },
    configs: [],
  };
}

function readGlobalContext(q: Quonfig): Record<string, Record<string, unknown>> | undefined {
  return (q as unknown as { globalContext?: Record<string, Record<string, unknown>> })
    .globalContext;
}

describe("tokenFilenameForApiUrls", () => {
  it.each([
    ["nil falls back", undefined, "tokens.json"],
    ["empty array falls back", [], "tokens.json"],
    ["empty string falls back", [""], "tokens.json"],
    ["unparseable URL falls back", ["::not a url::"], "tokens.json"],
    ["production app host", ["https://app.quonfig.com"], "tokens.json"],
    ["production primary host", ["https://primary.quonfig.com"], "tokens.json"],
    ["plain quonfig.com", ["https://quonfig.com"], "tokens.json"],
    ["staging app host", ["https://app.quonfig-staging.com"], "tokens-quonfig-staging-com.json"],
    [
      "staging primary host",
      ["https://primary.quonfig-staging.com"],
      "tokens-quonfig-staging-com.json",
    ],
    [
      "multi-region uses first URL",
      ["https://app.quonfig-staging.com", "https://app.quonfig.com"],
      "tokens-quonfig-staging-com.json",
    ],
    [
      "unknown subdomain pattern preserved as-is",
      ["https://quonfig-api-delivery-staging.fly.dev"],
      "tokens-quonfig-api-delivery-staging-fly-dev.json",
    ],
  ] as const)("%s", (_label, urls, expected) => {
    expect(tokenFilenameForApiUrls(urls as string[] | undefined)).toBe(expected);
  });
});

describe("Quonfig dev-context per-domain tokens file", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "quonfig-dev-ctx-domain-"));
    mkdirSync(join(tmpHome, ".quonfig"), { recursive: true });
    homedirMock = () => tmpHome;
    vi.stubEnv("QUONFIG_DEV_CONTEXT", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    homedirMock = () => "/nonexistent-default";
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("reads env-suffixed tokens file when apiUrl points to staging", async () => {
    writeFileSync(
      join(tmpHome, ".quonfig", "tokens-quonfig-staging-com.json"),
      JSON.stringify({ userEmail: "jeff@quonfig.com" })
    );

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      enableQuonfigUserContext: true,
      apiUrls: ["https://app.quonfig-staging.com"],
    });
    await q.init();

    expect(readGlobalContext(q)).toEqual({
      "quonfig-user": { email: "jeff@quonfig.com" },
    });
  });

  it("reads tokens.json when apiUrl points to production", async () => {
    writeFileSync(
      join(tmpHome, ".quonfig", "tokens.json"),
      JSON.stringify({ userEmail: "prod@example.com" })
    );

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      enableQuonfigUserContext: true,
      apiUrls: ["https://app.quonfig.com"],
    });
    await q.init();

    expect(readGlobalContext(q)).toEqual({
      "quonfig-user": { email: "prod@example.com" },
    });
  });

  it("reads tokens.json when no apiUrl provided (back-compat)", async () => {
    writeFileSync(
      join(tmpHome, ".quonfig", "tokens.json"),
      JSON.stringify({ userEmail: "bob@foo.com" })
    );

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      enableQuonfigUserContext: true,
    });
    await q.init();

    expect(readGlobalContext(q)).toEqual({
      "quonfig-user": { email: "bob@foo.com" },
    });
  });

  it("no-op when env-suffixed file is missing (does not fall back to prod tokens)", async () => {
    // Only the prod file exists; staging-suffixed file is absent.
    writeFileSync(
      join(tmpHome, ".quonfig", "tokens.json"),
      JSON.stringify({ userEmail: "prod@example.com" })
    );

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      enableQuonfigUserContext: true,
      apiUrls: ["https://app.quonfig-staging.com"],
    });
    await q.init();

    expect(readGlobalContext(q)).toEqual({});
  });

  it("multi-region apiUrls uses the first URL to derive the domain", async () => {
    writeFileSync(
      join(tmpHome, ".quonfig", "tokens-quonfig-staging-com.json"),
      JSON.stringify({ userEmail: "jeff@quonfig.com" })
    );

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      enableQuonfigUserContext: true,
      apiUrls: ["https://app.quonfig-staging.com", "https://app.quonfig.com"],
    });
    await q.init();

    expect(readGlobalContext(q)).toEqual({
      "quonfig-user": { email: "jeff@quonfig.com" },
    });
  });
});
