import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pino = require("pino");

import { Quonfig, QUONFIG_SDK_LOGGING_CONTEXT_NAME } from "../../src";
import {
  createPinoHooks,
  createPinoLogger,
} from "../../src/integrations/pino";
import type { WorkspaceConfigDocument } from "../../src/types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Capture every JSON line emitted by a Pino logger into an array. Uses
 * `pino.destination` with a custom write stream.
 */
function captureRecords(args: {
  quonfig: Quonfig;
  loggerPath: string;
}): { logger: any; records: Array<Record<string, unknown>> } {
  const records: Array<Record<string, unknown>> = [];

  const dest = {
    write(chunk: string): void {
      for (const line of chunk.split("\n")) {
        if (!line) continue;
        try {
          records.push(JSON.parse(line));
        } catch {
          // ignore partial frames
        }
      }
    },
  };

  const logger = pino(
    {
      level: "trace",
      name: args.loggerPath,
      hooks: createPinoHooks(args.quonfig, args.loggerPath),
    },
    dest
  );

  return { logger, records };
}

describe("Pino integration", () => {
  const buildDatadir = (): string => {
    return createDatadir({
      environments: ["Production"],
      entries: {
        "log-levels": [
          {
            id: "log-level.pino-app",
            key: "log-level.pino-app",
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
                    value: { type: "log_level", value: "warn" },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  };

  it("emits records above the configured level and drops those below", async () => {
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir: buildDatadir(),
      environment: "Production",
      loggerKey: "log-level.pino-app",
    });
    await quonfig.init();

    // foo.bar → debug level. debug + info emit, trace drops.
    const fooCapture = captureRecords({ quonfig, loggerPath: "foo.bar" });
    fooCapture.logger.debug("debug msg");
    fooCapture.logger.info("info msg");
    fooCapture.logger.trace("trace msg");

    const fooMessages = fooCapture.records.map((r) => r.msg);
    expect(fooMessages).toContain("debug msg");
    expect(fooMessages).toContain("info msg");
    expect(fooMessages).not.toContain("trace msg");

    // noisy.thing → error level. info drops, error emits.
    const noisyCapture = captureRecords({ quonfig, loggerPath: "noisy.thing" });
    noisyCapture.logger.info("info msg");
    noisyCapture.logger.error("error msg");

    const noisyMessages = noisyCapture.records.map((r) => r.msg);
    expect(noisyMessages).not.toContain("info msg");
    expect(noisyMessages).toContain("error msg");

    // other.path → warn default. debug drops, warn emits.
    const otherCapture = captureRecords({ quonfig, loggerPath: "other.path" });
    otherCapture.logger.debug("debug msg");
    otherCapture.logger.warn("warn msg");

    const otherMessages = otherCapture.records.map((r) => r.msg);
    expect(otherMessages).not.toContain("debug msg");
    expect(otherMessages).toContain("warn msg");
  });

  it("forwards the native loggerPath verbatim into the context", async () => {
    const datadir = createDatadir({
      environments: ["Production"],
      entries: {
        "log-levels": [
          {
            id: "log-level.pino-native",
            key: "log-level.pino-native",
            type: "log_level",
            valueType: "log_level",
            sendToClientSdk: false,
            default: {
              rules: [
                {
                  criteria: [{ operator: "ALWAYS_TRUE" }],
                  value: { type: "log_level", value: "error" },
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
                    value: { type: "log_level", value: "error" },
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
      loggerKey: "log-level.pino-native",
    });
    await quonfig.init();

    // Native identifier matches exact-match rule -> debug; info emits.
    const nativeCapture = captureRecords({
      quonfig,
      loggerPath: "MyApp::Services::Auth",
    });
    nativeCapture.logger.info("hello native");
    const nativeMessages = nativeCapture.records.map((r) => r.msg);
    expect(nativeMessages).toContain("hello native");
    // Pino records the logger name via `name` — we pass loggerPath through.
    expect(nativeCapture.records[0]?.name).toBe("MyApp::Services::Auth");

    // Normalized variant must NOT match → error default → info drops.
    const normalizedCapture = captureRecords({
      quonfig,
      loggerPath: "my_app.services.auth",
    });
    normalizedCapture.logger.info("hello normalized");
    const normalizedMessages = normalizedCapture.records.map((r) => r.msg);
    expect(normalizedMessages).not.toContain("hello normalized");
  });

  it("createPinoLogger returns a ready-to-use logger gated by shouldLog", async () => {
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir: buildDatadir(),
      environment: "Production",
      loggerKey: "log-level.pino-app",
    });
    await quonfig.init();

    const records: Array<Record<string, unknown>> = [];
    const dest = {
      write(chunk: string): void {
        for (const line of chunk.split("\n")) {
          if (!line) continue;
          try {
            records.push(JSON.parse(line));
          } catch {
            // ignore
          }
        }
      },
    };

    const logger = createPinoLogger(quonfig, "foo.bar", { destination: dest });

    // foo.* → debug rule. debug emits, trace drops.
    logger.debug("debug via factory");
    logger.trace("trace via factory");

    const messages = records.map((r) => r.msg);
    expect(messages).toContain("debug via factory");
    expect(messages).not.toContain("trace via factory");
    expect(records[0]?.name).toBe("foo.bar");
  });
});

// ---- helpers ----

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
  const dir = mkdtempSync(join(tmpdir(), "quonfig-sdk-node-pino-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
