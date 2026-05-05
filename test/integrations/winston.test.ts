import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Writable } from "stream";
import { afterEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const winston = require("winston");

import { Quonfig, QUONFIG_SDK_LOGGING_CONTEXT_NAME } from "../../src";
import { createWinstonFormat, createWinstonLogger } from "../../src/integrations/winston";
import type { WorkspaceConfigDocument } from "../../src/types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Spin up a Winston logger whose Console transport writes JSON into a buffer
 * we can assert on. Every record that gets through the Quonfig format lands
 * in `records`.
 */
function captureWinstonRecords(args: { quonfig: Quonfig; loggerPath: string }): {
  logger: any;
  records: Array<Record<string, unknown>>;
} {
  const records: Array<Record<string, unknown>> = [];

  const capture = new Writable({
    write(chunk: Buffer, _enc, cb) {
      // Winston's default JSON format emits one JSON object per line.
      for (const line of chunk.toString("utf8").split("\n")) {
        if (!line) continue;
        try {
          records.push(JSON.parse(line));
        } catch {
          // ignore partial frames
        }
      }
      cb();
    },
  });

  const logger = winston.createLogger({
    level: "silly", // emit everything; Quonfig is the gate.
    defaultMeta: { loggerPath: args.loggerPath },
    format: winston.format.combine(
      createWinstonFormat(args.quonfig, args.loggerPath),
      winston.format.json()
    ),
    transports: [new winston.transports.Stream({ stream: capture })],
  });

  return { logger, records };
}

describe("Winston integration", () => {
  // Rule: loggers under "foo." log at debug; loggers under "noisy." log at
  // error; everything else falls through to warn (default rule).
  const buildDatadir = (): string => {
    return createDatadir({
      environments: ["Production"],
      entries: {
        "log-levels": [
          {
            id: "log-level.winston-app",
            key: "log-level.winston-app",
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
      loggerKey: "log-level.winston-app",
    });
    await quonfig.init();

    // foo.bar -> debug level. debug + info should emit, trace should drop.
    const fooCapture = captureWinstonRecords({ quonfig, loggerPath: "foo.bar" });
    fooCapture.logger.debug("debug msg");
    fooCapture.logger.info("info msg");
    fooCapture.logger.silly("trace msg"); // silly maps to Quonfig trace → dropped.

    // Give Winston's async stream pipeline a tick to flush.
    await new Promise((r) => setImmediate(r));

    const fooMessages = fooCapture.records.map((r) => r.message);
    expect(fooMessages).toContain("debug msg");
    expect(fooMessages).toContain("info msg");
    expect(fooMessages).not.toContain("trace msg");

    // noisy.thing -> error level. info should drop, error should emit.
    const noisyCapture = captureWinstonRecords({
      quonfig,
      loggerPath: "noisy.thing",
    });
    noisyCapture.logger.info("info msg");
    noisyCapture.logger.error("error msg");
    await new Promise((r) => setImmediate(r));

    const noisyMessages = noisyCapture.records.map((r) => r.message);
    expect(noisyMessages).not.toContain("info msg");
    expect(noisyMessages).toContain("error msg");

    // Default: other.path -> warn. debug drops, warn emits.
    const otherCapture = captureWinstonRecords({
      quonfig,
      loggerPath: "other.path",
    });
    otherCapture.logger.debug("debug msg");
    otherCapture.logger.warn("warn msg");
    await new Promise((r) => setImmediate(r));

    const otherMessages = otherCapture.records.map((r) => r.message);
    expect(otherMessages).not.toContain("debug msg");
    expect(otherMessages).toContain("warn msg");
  });

  it("forwards the native loggerPath verbatim into the context", async () => {
    // Rule keyed on the EXACT unnormalized loggerPath string.
    const datadir = createDatadir({
      environments: ["Production"],
      entries: {
        "log-levels": [
          {
            id: "log-level.winston-native",
            key: "log-level.winston-native",
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
      loggerKey: "log-level.winston-native",
    });
    await quonfig.init();

    // Native identifier matches the exact-match rule -> debug level. info emits.
    const nativeCapture = captureWinstonRecords({
      quonfig,
      loggerPath: "MyApp::Services::Auth",
    });
    nativeCapture.logger.info("hello native");
    await new Promise((r) => setImmediate(r));

    const nativeMessages = nativeCapture.records.map((r) => r.message);
    expect(nativeMessages).toContain("hello native");
    // And the native path shows up in defaultMeta unmodified.
    expect(nativeCapture.records[0]?.loggerPath).toBe("MyApp::Services::Auth");

    // A "normalized" variant must NOT match the exact rule → falls back to
    // error default, so an info call drops.
    const normalizedCapture = captureWinstonRecords({
      quonfig,
      loggerPath: "my_app.services.auth",
    });
    normalizedCapture.logger.info("hello normalized");
    await new Promise((r) => setImmediate(r));

    const normalizedMessages = normalizedCapture.records.map((r) => r.message);
    expect(normalizedMessages).not.toContain("hello normalized");
  });

  it("createWinstonLogger returns a ready-to-use logger gated by shouldLog", async () => {
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir: buildDatadir(),
      environment: "Production",
      loggerKey: "log-level.winston-app",
    });
    await quonfig.init();

    // Swap in a stream transport so we can assert on emitted lines.
    const emitted: string[] = [];
    const capture = new Writable({
      write(chunk: Buffer, _enc, cb) {
        emitted.push(chunk.toString("utf8"));
        cb();
      },
    });

    const logger = createWinstonLogger(quonfig, "foo.bar", {
      loggerOptions: {
        transports: [new winston.transports.Stream({ stream: capture })],
      },
    });

    logger.debug("debug via factory"); // foo.* → debug level → emits.
    logger.silly("trace via factory"); // trace → drops.
    await new Promise((r) => setImmediate(r));

    const joined = emitted.join("");
    expect(joined).toContain("debug via factory");
    expect(joined).not.toContain("trace via factory");
  });
});

// ---- helpers (mirrors test/logger-path.test.ts) ----

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
  const dir = mkdtempSync(join(tmpdir(), "quonfig-sdk-node-winston-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
