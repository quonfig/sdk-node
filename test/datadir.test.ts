import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEnvelopeFromDatadir } from "../src/datadir";
import { Quonfig } from "../src/quonfig";
import { Transport } from "../src/transport";
import type { ConfigEnvelope, WorkspaceConfigDocument } from "../src/types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("Quonfig datadir", () => {
  it("loads configs from the workspace datadir layout", async () => {
    const datadir = createDatadir({
      environments: ["Production"],
      entries: {
        configs: [
          configDoc({
            id: "cfg-1",
            key: "welcome-message",
            type: "config",
            valueType: "string",
            defaultValue: "hello",
            environments: [
              {
                id: "Production",
                rules: [alwaysTrueRule("hola")],
              },
            ],
          }),
        ],
        "feature-flags": [
          configDoc({
            id: "flag-1",
            key: "new-dashboard",
            type: "feature_flag",
            valueType: "bool",
            defaultValue: false,
            environments: [
              {
                id: "Production",
                rules: [alwaysTrueRule(true)],
              },
            ],
          }),
        ],
        segments: [
          configDoc({
            id: "seg-1",
            key: "beta-users",
            type: "segment",
            valueType: "bool",
            defaultValue: false,
            environments: [
              {
                id: "Production",
                rules: [
                  {
                    criteria: [
                      {
                        propertyName: "user.plan",
                        operator: "PROP_IS_ONE_OF",
                        valueToMatch: {
                          type: "string_list",
                          value: ["pro"],
                        },
                      },
                    ],
                    value: {
                      type: "bool",
                      value: true,
                    },
                  },
                ],
              },
            ],
          }),
        ],
      },
    });

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
    });

    await quonfig.init();

    expect(quonfig.getString("welcome-message")).toBe("hola");
    expect(quonfig.isEnabled("new-dashboard")).toBe(true);
    expect(
      quonfig.isEnabled("beta-users", {
        user: { plan: "pro" },
      })
    ).toBe(true);
    expect(
      quonfig.isEnabled("beta-users", {
        user: { plan: "free" },
      })
    ).toBe(false);
    expect(quonfig.keys().sort()).toEqual(["beta-users", "new-dashboard", "welcome-message"]);
  });

  it("supports quonfig.json with an environment list", async () => {
    const datadir = createDatadir({
      environments: ["Production", "staging"],
      entries: {
        configs: [
          configDoc({
            key: "environment-name-selection",
            type: "config",
            valueType: "string",
            defaultValue: "default",
            environments: [
              {
                id: "staging",
                rules: [alwaysTrueRule("from-staging")],
              },
              {
                id: "Production",
                rules: [alwaysTrueRule("from-production")],
              },
            ],
          }),
        ],
      },
    });

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "staging",
    });

    await quonfig.init();

    expect(quonfig.getString("environment-name-selection")).toBe("from-staging");
  });

  it("supports quonfig.json with an empty environment list (accepts any environment)", async () => {
    const datadir = createDatadir({
      environments: [],
      entries: {
        "feature-flags": [
          configDoc({
            key: "phase0",
            type: "feature_flag",
            valueType: "bool",
            defaultValue: true,
          }),
        ],
      },
    });

    // Empty environments list accepts any environment name
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "development",
    });

    await quonfig.init();

    expect(quonfig.isEnabled("phase0")).toBe(true);
    // isFeatureEnabled is a deprecated alias of isEnabled; both must agree.
    expect(quonfig.isFeatureEnabled("phase0")).toBe(quonfig.isEnabled("phase0"));
    const bound = quonfig.inContext({ user: { key: "u" } });
    expect(bound.isFeatureEnabled("phase0")).toBe(bound.isEnabled("phase0"));
  });

  it("prefers datadir over datafile when both are provided", async () => {
    const datadir = createDatadir({
      environments: ["Production"],
      entries: {
        configs: [
          configDoc({
            key: "source-priority",
            type: "config",
            valueType: "string",
            defaultValue: "from-datadir-default",
            environments: [
              {
                id: "Production",
                rules: [alwaysTrueRule("from-datadir")],
              },
            ],
          }),
        ],
      },
    });

    const datafile: ConfigEnvelope = {
      meta: {
        version: "datafile-version",
        environment: "Production",
      },
      configs: [
        {
          id: "file-1",
          key: "source-priority",
          type: "config",
          valueType: "string",
          sendToClientSdk: false,
          default: {
            rules: [
              {
                criteria: [{ operator: "ALWAYS_TRUE" }],
                value: {
                  type: "string",
                  value: "from-datafile",
                },
              },
            ],
          },
          environment: {
            id: "Production",
            rules: [
              {
                criteria: [{ operator: "ALWAYS_TRUE" }],
                value: {
                  type: "string",
                  value: "from-datafile",
                },
              },
            ],
          },
        },
      ],
    };

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      datafile,
      environment: "Production",
    });

    await quonfig.init();

    expect(quonfig.getString("source-priority")).toBe("from-datadir");
  });

  it("fails when quonfig.json is missing", async () => {
    const datadir = createTempDir();

    mkdirSync(join(datadir, "configs"), { recursive: true });
    writeJson(
      join(datadir, "configs", "missing-env.json"),
      configDoc({
        key: "missing-env",
        type: "config",
        valueType: "string",
        defaultValue: "default",
      })
    );

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
    });

    await expect(quonfig.init()).rejects.toThrow("Datadir is missing quonfig.json");
  });

  it("forces sendToClientSdk=true for feature_flag configs (field absent on disk)", () => {
    const datadir = createTempDir();
    writeJson(join(datadir, "quonfig.json"), { environments: ["Production"] });
    mkdirSync(join(datadir, "feature-flags"), { recursive: true });
    // Feature flag WITHOUT sendToClientSdk on disk — simulates the new on-disk shape.
    writeJson(join(datadir, "feature-flags", "flag-a.json"), {
      id: "flag-a",
      key: "flag-a",
      type: "feature_flag",
      valueType: "bool",
      default: { rules: [alwaysTrueRule(true)] },
    });
    // Feature flag WITH sendToClientSdk: false — must also be forced true.
    writeJson(join(datadir, "feature-flags", "flag-b.json"), {
      id: "flag-b",
      key: "flag-b",
      type: "feature_flag",
      valueType: "bool",
      sendToClientSdk: false,
      default: { rules: [alwaysTrueRule(true)] },
    });
    // Non-flag (config) with sendToClientSdk absent — must stay false.
    mkdirSync(join(datadir, "configs"), { recursive: true });
    writeJson(join(datadir, "configs", "cfg-a.json"), {
      id: "cfg-a",
      key: "cfg-a",
      type: "config",
      valueType: "string",
      default: { rules: [alwaysTrueRule("x")] },
    });

    const envelope = loadEnvelopeFromDatadir(datadir, "Production");
    const byKey = Object.fromEntries(envelope.configs.map((c) => [c.key, c]));

    expect(byKey["flag-a"].sendToClientSdk).toBe(true);
    expect(byKey["flag-b"].sendToClientSdk).toBe(true);
    expect(byKey["cfg-a"].sendToClientSdk).toBe(false);
  });

  it("parses string log levels from datadir configs", async () => {
    const datadir = createDatadir({
      environments: ["Production"],
      entries: {
        "log-levels": [
          configDoc({
            key: "log-level.service.api",
            type: "log_level",
            valueType: "log_level",
            defaultValue: "warn",
            environments: [
              {
                id: "Production",
                rules: [alwaysTrueRule("info")],
              },
            ],
          }),
        ],
      },
    });

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
    });

    await quonfig.init();

    expect(
      quonfig.shouldLog({
        configKey: "log-level.service.api",
        desiredLevel: "debug",
      })
    ).toBe(false);
    expect(
      quonfig.shouldLog({
        configKey: "log-level.service.api",
        desiredLevel: "info",
      })
    ).toBe(true);
  });

  it("ignores schemas/ JSON Schema docs (no empty-key configs in envelope)", () => {
    const datadir = createTempDir();
    writeJson(join(datadir, "quonfig.json"), { environments: ["production"] });

    // A real JSON Schema document — has no `key`/`type`/`valueType` fields.
    mkdirSync(join(datadir, "schemas"), { recursive: true });
    writeJson(join(datadir, "schemas", "user-shape.json"), {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://quonfig.com/schemas/user-shape",
      title: "User",
      type: "object",
      properties: {
        id: { type: "string" },
        plan: { type: "string" },
      },
      required: ["id"],
    });

    // A real config alongside, so we know the loader still works for valid dirs.
    mkdirSync(join(datadir, "configs"), { recursive: true });
    writeJson(
      join(datadir, "configs", "real-config.json"),
      configDoc({
        key: "real-config",
        type: "config",
        valueType: "string",
        defaultValue: "ok",
      })
    );

    const envelope = loadEnvelopeFromDatadir(datadir, "production");

    // No empty-key or undefined-key configs should leak through.
    for (const cfg of envelope.configs) {
      expect(cfg.key, `unexpected config from schema doc: ${JSON.stringify(cfg)}`).toBeTruthy();
    }
    expect(envelope.configs.map((c) => c.key)).toEqual(["real-config"]);
  });

  it("rejects config files with missing/empty key (defense-in-depth)", () => {
    const datadir = createTempDir();
    writeJson(join(datadir, "quonfig.json"), { environments: ["production"] });

    mkdirSync(join(datadir, "configs"), { recursive: true });
    // A schema-like doc misplaced into configs/ — must be rejected, not silently
    // turned into an empty-key ConfigResponse.
    writeJson(join(datadir, "configs", "stray-schema.json"), {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Stray",
      type: "object",
    });

    expect(() => loadEnvelopeFromDatadir(datadir, "production")).toThrow(/empty key/i);
  });

  it("flush posts pending telemetry after evaluation", async () => {
    const envelope: ConfigEnvelope = {
      meta: {
        version: "test-version",
        environment: "Production",
      },
      configs: [
        {
          id: "cfg-1",
          key: "welcome-message",
          type: "config",
          valueType: "string",
          sendToClientSdk: false,
          default: {
            rules: [alwaysTrueRule("hello")],
          },
          environment: {
            id: "Production",
            rules: [alwaysTrueRule("hola")],
          },
        },
      ],
    };

    const fetchSpy = vi
      .spyOn(Transport.prototype, "fetchFromUrlAt")
      .mockResolvedValue({ result: { envelope, notChanged: false }, sourceIndex: 0 });
    const postTelemetrySpy = vi
      .spyOn(Transport.prototype, "postTelemetry")
      .mockResolvedValue(undefined);

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: false,
      enablePolling: false,
    });

    await quonfig.init();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(quonfig.getString("welcome-message")).toBe("hola");

    await quonfig.flush();

    expect(postTelemetrySpy).toHaveBeenCalledTimes(1);
    expect(postTelemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceHash: expect.any(String),
        events: [
          expect.objectContaining({
            summaries: expect.objectContaining({
              summaries: expect.arrayContaining([
                expect.objectContaining({
                  key: "welcome-message",
                }),
              ]),
            }),
          }),
        ],
      })
    );

    quonfig.close();
  });
});

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
  const dir = mkdtempSync(join(tmpdir(), "quonfig-sdk-node-"));
  tempDirs.push(dir);
  return dir;
}

function configDoc(args: {
  id?: string;
  key: string;
  type: WorkspaceConfigDocument["type"];
  valueType: WorkspaceConfigDocument["valueType"];
  defaultValue: string | boolean;
  environments?: WorkspaceConfigDocument["environments"];
}): WorkspaceConfigDocument {
  return {
    id: args.id ?? `${args.key}-id`,
    key: args.key,
    type: args.type,
    valueType: args.valueType,
    sendToClientSdk: false,
    default: {
      rules: [alwaysTrueRule(args.defaultValue)],
    },
    environments: args.environments ?? [],
  };
}

function alwaysTrueRule(value: string | boolean) {
  return {
    criteria: [{ operator: "ALWAYS_TRUE" }],
    value: {
      type: typeof value === "boolean" ? "bool" : "string",
      value,
    },
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
