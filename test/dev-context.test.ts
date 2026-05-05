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

describe("Quonfig dev-context injection", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "quonfig-dev-ctx-"));
    mkdirSync(join(tmpHome, ".quonfig"), { recursive: true });
    homedirMock = () => tmpHome;
    vi.stubEnv("QUONFIG_DEV_CONTEXT", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    homedirMock = () => "/nonexistent-default";
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("injects quonfig-user.email when option enabled and file exists", async () => {
    writeFileSync(
      join(tmpHome, ".quonfig", "tokens.json"),
      JSON.stringify({
        userEmail: "bob@foo.com",
        accessToken: "x",
        refreshToken: "y",
        expiresAt: 0,
      })
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

  it("no-op when option disabled and no env var", async () => {
    writeFileSync(
      join(tmpHome, ".quonfig", "tokens.json"),
      JSON.stringify({ userEmail: "bob@foo.com" })
    );

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      globalContext: { user: { plan: "pro" } },
    });
    await q.init();

    expect(readGlobalContext(q)).toEqual({ user: { plan: "pro" } });
  });

  it("no-op when option enabled but file missing", async () => {
    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      enableQuonfigUserContext: true,
      globalContext: { user: { plan: "pro" } },
    });
    await q.init();

    expect(readGlobalContext(q)).toEqual({ user: { plan: "pro" } });
  });

  it("no-op when option enabled but file is unparseable", async () => {
    writeFileSync(join(tmpHome, ".quonfig", "tokens.json"), "{not valid json");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      enableQuonfigUserContext: true,
    });
    await q.init();

    expect(readGlobalContext(q)).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/quonfig.*dev-context/i);
    warnSpy.mockRestore();
  });

  it("customer-supplied quonfig-user keys win on collision", async () => {
    writeFileSync(
      join(tmpHome, ".quonfig", "tokens.json"),
      JSON.stringify({ userEmail: "bob@foo.com" })
    );

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
      enableQuonfigUserContext: true,
      globalContext: { "quonfig-user": { email: "override@x.com" } },
    });
    await q.init();

    expect(readGlobalContext(q)).toEqual({
      "quonfig-user": { email: "override@x.com" },
    });
  });

  it("env var QUONFIG_DEV_CONTEXT=true enables the same behavior", async () => {
    writeFileSync(
      join(tmpHome, ".quonfig", "tokens.json"),
      JSON.stringify({ userEmail: "bob@foo.com" })
    );
    vi.stubEnv("QUONFIG_DEV_CONTEXT", "true");

    const q = new Quonfig({
      sdkKey: "test",
      datafile: emptyEnvelope(),
    });
    await q.init();

    expect(readGlobalContext(q)).toEqual({
      "quonfig-user": { email: "bob@foo.com" },
    });
  });

  it("integration: rule keyed on quonfig-user.email fires when injected", async () => {
    writeFileSync(
      join(tmpHome, ".quonfig", "tokens.json"),
      JSON.stringify({ userEmail: "bob@foo.com" })
    );

    const envelope: ConfigEnvelope = {
      meta: { version: "test", environment: "Production" },
      configs: [
        {
          id: "cfg-flag",
          key: "my-flag",
          type: "feature_flag",
          valueType: "bool",
          sendToClientSdk: false,
          default: {
            rules: [
              {
                criteria: [{ operator: "ALWAYS_TRUE" }],
                value: { type: "bool", value: false },
              },
            ],
          },
          environment: {
            id: "Production",
            rules: [
              {
                criteria: [
                  {
                    propertyName: "quonfig-user.email",
                    operator: "PROP_IS_ONE_OF",
                    valueToMatch: { type: "string_list", value: ["bob@foo.com"] },
                  },
                ],
                value: { type: "bool", value: true },
              },
              {
                criteria: [{ operator: "ALWAYS_TRUE" }],
                value: { type: "bool", value: false },
              },
            ],
          },
        },
      ],
    };

    const q = new Quonfig({
      sdkKey: "test",
      datafile: envelope,
      environment: "Production",
      enableQuonfigUserContext: true,
    });
    await q.init();

    expect(q.getBool("my-flag")).toBe(true);
  });
});
