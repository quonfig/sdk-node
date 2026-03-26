import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import { Quonfig } from "../src/quonfig";
import type { ConfigEnvelope, WorkspaceConfigDocument } from "../src/types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Quonfig datadir", () => {
  it("loads configs from the workspace datadir layout", async () => {
    const datadir = createDatadir({
      environments: { "143": "Production" },
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
    });

    await quonfig.init();

    expect(quonfig.getString("welcome-message")).toBe("hola");
    expect(quonfig.isFeatureEnabled("new-dashboard")).toBe(true);
    expect(
      quonfig.isFeatureEnabled("beta-users", {
        user: { plan: "pro" },
      })
    ).toBe(true);
    expect(
      quonfig.isFeatureEnabled("beta-users", {
        user: { plan: "free" },
      })
    ).toBe(false);
    expect(quonfig.keys().sort()).toEqual(["beta-users", "new-dashboard", "welcome-message"]);
  });

  it("supports environments.json keyed by environment name", async () => {
    const datadir = createDatadir({
      environments: { Production: "env-143" },
      entries: {
        configs: [
          configDoc({
            key: "environment-name-selection",
            type: "config",
            valueType: "string",
            defaultValue: "default",
            environments: [
              {
                id: "env-143",
                rules: [alwaysTrueRule("selected-by-value")],
              },
              {
                id: "Production",
                rules: [alwaysTrueRule("selected-by-key")],
              },
            ],
          }),
        ],
      },
    });

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
    });

    await quonfig.init();

    expect(quonfig.getString("environment-name-selection")).toBe("selected-by-value");
  });

  it("supports wrapped environments.json with an empty environment list", async () => {
    const datadir = createDatadir({
      environments: { environments: [] },
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

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
    });

    await quonfig.init();

    expect(quonfig.isFeatureEnabled("phase0")).toBe(true);
  });

  it("prefers datadir over datafile when both are provided", async () => {
    const datadir = createDatadir({
      environments: { "143": "Production" },
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
    });

    await quonfig.init();

    expect(quonfig.getString("source-priority")).toBe("from-datadir");
  });

  it("fails when environments.json is missing", async () => {
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
    });

    await expect(quonfig.init()).rejects.toThrow("Datadir is missing environments.json");
  });
});

function createDatadir(args: {
  environments: Record<string, string> | { environments: Array<string | { id?: string; name?: string }> };
  entries: Partial<Record<"configs" | "feature-flags" | "segments" | "schemas" | "log-levels", WorkspaceConfigDocument[]>>;
}): string {
  const datadir = createTempDir();

  writeJson(join(datadir, "environments.json"), args.environments);

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
