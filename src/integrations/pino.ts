import type { Quonfig, BoundQuonfig } from "../quonfig";
import type { Contexts } from "../types";

/**
 * Pino level numbers (see https://getpino.io/#/docs/api?id=level-string).
 *
 *   trace = 10
 *   debug = 20
 *   info  = 30
 *   warn  = 40
 *   error = 50
 *   fatal = 60
 */
const PINO_LEVEL_NUMBER_TO_QUONFIG: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

/**
 * Map a Pino level name to a Quonfig level string.
 */
function pinoLevelToQuonfigLevel(level: string): string {
  const normalized = level.toLowerCase();
  switch (normalized) {
    case "trace":
    case "debug":
    case "info":
    case "warn":
    case "error":
    case "fatal":
      return normalized;
    default:
      return "info";
  }
}

/**
 * Options accepted by {@link createPinoHooks} and {@link createPinoLogger}.
 */
export interface PinoIntegrationOptions {
  /**
   * Optional additional contexts merged into the shouldLog call for every
   * record. Useful for tenant / user context that should drive per-logger rules.
   */
  contexts?: Contexts;
  /**
   * Default level (as a Quonfig level string — `"trace" | "debug" | "info"
   * | "warn" | "error" | "fatal"`) passed through to `shouldLog` when no
   * matching log-level config is found.
   */
  defaultLevel?: string;
}

/**
 * Create a Pino `hooks` object that gates log records through
 * `quonfig.shouldLog`. Pass it to `pino({ hooks: ... })`.
 *
 * Implementation: Pino exposes `hooks.logMethod`, which wraps every log
 * method call. We consult Quonfig and only invoke the underlying method if
 * `shouldLog` returns true. When the hook returns without invoking the
 * method, Pino emits nothing — exactly the desired drop semantic.
 *
 * `loggerPath` is passed through to `shouldLog` verbatim — no normalization.
 *
 * @example
 * ```ts
 * import pino from "pino";
 * import { Quonfig } from "@quonfig/node";
 * import { createPinoHooks } from "@quonfig/node/pino";
 *
 * const quonfig = new Quonfig({
 *   sdkKey: process.env.QUONFIG_BACKEND_SDK_KEY!,
 *   loggerKey: "log-level.my-app",
 * });
 * await quonfig.init();
 *
 * const logger = pino({
 *   level: "trace", // let Pino emit everything; Quonfig decides.
 *   hooks: createPinoHooks(quonfig, "myapp.services.auth"),
 * });
 * ```
 */
export function createPinoHooks(
  quonfig: Quonfig | BoundQuonfig,
  loggerPath: string,
  options: PinoIntegrationOptions = {}
): { logMethod: (args: unknown[], method: Function, level: number) => void } {
  return {
    logMethod(this: any, args: unknown[], method: Function, level: number) {
      const levelName =
        PINO_LEVEL_NUMBER_TO_QUONFIG[level] ??
        (typeof this?.levels?.labels?.[level] === "string"
          ? pinoLevelToQuonfigLevel(this.levels.labels[level])
          : "info");

      const allowed = quonfig.shouldLog({
        loggerPath,
        desiredLevel: levelName,
        defaultLevel: options.defaultLevel,
        contexts: options.contexts,
      });

      if (allowed) {
        method.apply(this, args as any);
      }
    },
  };
}

/**
 * Options accepted by {@link createPinoLogger}.
 *
 * `loggerOptions` is passed straight to `pino()`. We set `level: "trace"`
 * by default so Pino emits every record and lets Quonfig decide. Callers
 * can still override any of Pino's native options.
 *
 * `destination` — when provided, passed as Pino's second argument. Use
 * this to redirect output to a file, a sonic-boom stream, or a test
 * capture buffer.
 */
export interface CreatePinoLoggerOptions extends PinoIntegrationOptions {
  loggerOptions?: Record<string, unknown>;
  destination?: unknown;
}

/**
 * Convenience constructor that returns a ready-to-use Pino logger whose
 * emissions are gated by Quonfig. Prefer {@link createPinoHooks} when you
 * already have your own Pino logger.
 */
export function createPinoLogger(
  quonfig: Quonfig | BoundQuonfig,
  loggerPath: string,
  options: CreatePinoLoggerOptions = {}
): any {
  let pino: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pino = require("pino");
  } catch {
    throw new Error("[quonfig] createPinoLogger requires pino. Install it with: npm install pino");
  }

  const pinoFactory = typeof pino === "function" ? pino : pino.default;
  const { loggerOptions = {}, destination, ...hookOptions } = options;

  const mergedOptions = {
    level: "trace",
    name: loggerPath,
    ...loggerOptions,
    hooks: {
      ...((loggerOptions as any).hooks ?? {}),
      ...createPinoHooks(quonfig, loggerPath, hookOptions),
    },
  };

  return destination !== undefined
    ? pinoFactory(mergedOptions, destination)
    : pinoFactory(mergedOptions);
}
