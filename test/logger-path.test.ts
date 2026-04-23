import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import { Quonfig, QUONFIG_SDK_LOGGING_CONTEXT_NAME } from "../src";
import type { WorkspaceConfigDocument } from "../src/types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("shouldLog({loggerPath}) convenience", () => {
  // Builds a datadir with a single `log-level.test-app` config whose rules
  // key off `quonfig-sdk-logging.key`:
  //   - key starts with "foo."  -> debug
  //   - key starts with "noisy."-> error
  //   - otherwise               -> info (default rule)
  const buildTestAppDatadir = (): string => {
    return createDatadir({
      environments: ["Production"],
      entries: {
        "log-levels": [
          {
            id: "log-level.test-app-id",
            key: "log-level.test-app",
            type: "log_level",
            valueType: "log_level",
            sendToClientSdk: false,
            default: {
              rules: [
                {
                  criteria: [{ operator: "ALWAYS_TRUE" }],
                  value: { type: "log_level", value: "info" },
                },
              ],
            },
            environments: [
              {
                id: "Production",
                rules: [
                  {
                    criteria: [
                      {
                        propertyName: `${QUONFIG_SDK_LOGGING_CONTEXT_NAME}.key`,
                        operator: "PROP_STARTS_WITH_ONE_OF",
                        valueToMatch: {
                          type: "string_list",
                          value: ["foo."],
                        },
                      },
                    ],
                    value: { type: "log_level", value: "debug" },
                  },
                  {
                    criteria: [
                      {
                        propertyName: `${QUONFIG_SDK_LOGGING_CONTEXT_NAME}.key`,
                        operator: "PROP_STARTS_WITH_ONE_OF",
                        valueToMatch: {
                          type: "string_list",
                          value: ["noisy."],
                        },
                      },
                    ],
                    value: { type: "log_level", value: "error" },
                  },
                  {
                    criteria: [{ operator: "ALWAYS_TRUE" }],
                    value: { type: "log_level", value: "info" },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  };

  it("evaluates per-logger rules for loggerPath via the injected context", async () => {
    const datadir = buildTestAppDatadir();

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
      loggerKey: "log-level.test-app",
    });

    await quonfig.init();

    // foo.bar -> debug rule. debug emits debug/info/warn/error/fatal.
    expect(
      quonfig.shouldLog({ loggerPath: "foo.bar", desiredLevel: "debug" })
    ).toBe(true);
    expect(
      quonfig.shouldLog({ loggerPath: "foo.bar", desiredLevel: "info" })
    ).toBe(true);
    expect(
      quonfig.shouldLog({ loggerPath: "foo.bar", desiredLevel: "trace" })
    ).toBe(false);

    // noisy.thing -> error rule. error does NOT emit info.
    expect(
      quonfig.shouldLog({ loggerPath: "noisy.thing", desiredLevel: "info" })
    ).toBe(false);
    expect(
      quonfig.shouldLog({ loggerPath: "noisy.thing", desiredLevel: "error" })
    ).toBe(true);

    // otherwise -> info default rule. info does NOT emit debug.
    expect(
      quonfig.shouldLog({ loggerPath: "other.thing", desiredLevel: "debug" })
    ).toBe(false);
    expect(
      quonfig.shouldLog({ loggerPath: "other.thing", desiredLevel: "info" })
    ).toBe(true);
  });

  it("passes native identifiers through unnormalized", async () => {
    // We route a Ruby-style identifier "MyApp::Services::Auth" through a rule
    // that requires the EXACT unnormalized string. If the SDK were to snake-case
    // / dot-ify the path (`my_app.services.auth`), this rule would not match.
    const datadir = createDatadir({
      environments: ["Production"],
      entries: {
        "log-levels": [
          {
            id: "log-level.native-id",
            key: "log-level.native-id",
            type: "log_level",
            valueType: "log_level",
            sendToClientSdk: false,
            default: {
              rules: [
                {
                  criteria: [{ operator: "ALWAYS_TRUE" }],
                  value: { type: "log_level", value: "warn" },
                },
              ],
            },
            environments: [
              {
                id: "Production",
                rules: [
                  {
                    criteria: [
                      {
                        propertyName: `${QUONFIG_SDK_LOGGING_CONTEXT_NAME}.key`,
                        operator: "PROP_IS_ONE_OF",
                        valueToMatch: {
                          type: "string_list",
                          value: ["MyApp::Services::Auth"],
                        },
                      },
                    ],
                    value: { type: "log_level", value: "debug" },
                  },
                  {
                    criteria: [{ operator: "ALWAYS_TRUE" }],
                    value: { type: "log_level", value: "warn" },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
      loggerKey: "log-level.native-id",
    });

    await quonfig.init();

    // Unnormalized identifier must match -> debug -> "info" emits.
    expect(
      quonfig.shouldLog({
        loggerPath: "MyApp::Services::Auth",
        desiredLevel: "info",
      })
    ).toBe(true);

    // What a normalizing SDK might send instead — we EXPECT this NOT to match
    // the exact-value rule, so it falls to the warn default, which does not
    // emit info. This is the proof that no normalization occurred.
    expect(
      quonfig.shouldLog({
        loggerPath: "my_app.services.auth",
        desiredLevel: "info",
      })
    ).toBe(false);
  });

  it("throws when loggerPath is passed but loggerKey was not set at init", async () => {
    const datadir = buildTestAppDatadir();

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
      // no loggerKey
    });
    await quonfig.init();

    expect(() =>
      quonfig.shouldLog({ loggerPath: "foo.bar", desiredLevel: "info" })
    ).toThrow(/loggerKey/);
  });

  it("preserves the existing shouldLog({configKey}) primitive unchanged", async () => {
    const datadir = createDatadir({
      environments: ["Production"],
      entries: {
        "log-levels": [
          {
            id: "log-level.raw-id",
            key: "log-level.raw",
            type: "log_level",
            valueType: "log_level",
            sendToClientSdk: false,
            default: {
              rules: [
                {
                  criteria: [{ operator: "ALWAYS_TRUE" }],
                  value: { type: "log_level", value: "info" },
                },
              ],
            },
            environments: [
              {
                id: "Production",
                rules: [
                  {
                    criteria: [{ operator: "ALWAYS_TRUE" }],
                    value: { type: "log_level", value: "info" },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
      // loggerKey deliberately omitted — {configKey} is the escape hatch.
    });
    await quonfig.init();

    // info emits info but not debug.
    expect(
      quonfig.shouldLog({ configKey: "log-level.raw", desiredLevel: "info" })
    ).toBe(true);
    expect(
      quonfig.shouldLog({ configKey: "log-level.raw", desiredLevel: "debug" })
    ).toBe(false);
  });

  it("BoundQuonfig inherits loggerKey and merges bound contexts", async () => {
    // Rule: only match when tenant=alpha AND logger path starts with "svc."
    const datadir = createDatadir({
      environments: ["Production"],
      entries: {
        "log-levels": [
          {
            id: "log-level.tenant-app",
            key: "log-level.tenant-app",
            type: "log_level",
            valueType: "log_level",
            sendToClientSdk: false,
            default: {
              rules: [
                {
                  criteria: [{ operator: "ALWAYS_TRUE" }],
                  value: { type: "log_level", value: "warn" },
                },
              ],
            },
            environments: [
              {
                id: "Production",
                rules: [
                  {
                    criteria: [
                      {
                        propertyName: "tenant.id",
                        operator: "PROP_IS_ONE_OF",
                        valueToMatch: { type: "string_list", value: ["alpha"] },
                      },
                      {
                        propertyName: `${QUONFIG_SDK_LOGGING_CONTEXT_NAME}.key`,
                        operator: "PROP_STARTS_WITH_ONE_OF",
                        valueToMatch: { type: "string_list", value: ["svc."] },
                      },
                    ],
                    value: { type: "log_level", value: "debug" },
                  },
                  {
                    criteria: [{ operator: "ALWAYS_TRUE" }],
                    value: { type: "log_level", value: "warn" },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
      loggerKey: "log-level.tenant-app",
    });
    await quonfig.init();

    const bound = quonfig.inContext({ tenant: { id: "alpha" } });

    // Bound tenant=alpha + svc.* path -> debug rule.
    expect(
      bound.shouldLog({ loggerPath: "svc.users", desiredLevel: "debug" })
    ).toBe(true);
    // Non-matching path -> warn default, does not emit info.
    expect(
      bound.shouldLog({ loggerPath: "other.path", desiredLevel: "info" })
    ).toBe(false);

    // Without the bound tenant context -> warn default, debug not emitted.
    expect(
      quonfig.shouldLog({ loggerPath: "svc.users", desiredLevel: "debug" })
    ).toBe(false);
  });
});

// ---- helpers (mirrors test/datadir.test.ts) ----

function createDatadir(args: {
  environments: string[];
  entries: Partial<
    Record<
      "configs" | "feature-flags" | "segments" | "schemas" | "log-levels",
      WorkspaceConfigDocument[]
    >
  >;
}): string {
  const datadir = createTempDir();

  writeJson(join(datadir, "quonfig.json"), { environments: args.environments });

  for (const [subdir, docs] of Object.entries(args.entries)) {
    mkdirSync(join(datadir, subdir), { recursive: true });

    for (const doc of docs ?? []) {
      writeJson(join(datadir, subdir, `${doc.key}.json`), doc);
    }
  }

  return datadir;
}

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "quonfig-sdk-node-logger-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
