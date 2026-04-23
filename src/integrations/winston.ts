import type { Quonfig, BoundQuonfig } from "../quonfig";
import type { Contexts } from "../types";

/**
 * The subset of a Winston log record we inspect. Winston attaches the log
 * level at `info.level` (a string such as `"info"`, `"warn"`, `"debug"`, etc.).
 */
interface WinstonInfo {
  level: string;
  [key: string]: unknown;
}

/**
 * Options accepted by {@link createWinstonFormat}.
 */
export interface CreateWinstonFormatOptions {
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
 * Map a Winston level name to a Quonfig level string.
 *
 * Winston's default `npm` levels are:
 *   error, warn, info, http, verbose, debug, silly
 * Winston also supports `syslog` levels which include `emerg`, `alert`,
 * `crit`, `notice`. We map them down to Quonfig's six canonical names:
 *   trace, debug, info, warn, error, fatal.
 *
 * Unknown levels fall through to `"info"` so we never accidentally silence
 * a log message due to a mapping miss.
 */
function winstonLevelToQuonfigLevel(level: string): string {
  switch (level) {
    case "silly":
    case "trace":
      return "trace";
    case "debug":
    case "verbose":
    case "http":
      return "debug";
    case "info":
    case "notice":
      return "info";
    case "warn":
    case "warning":
      return "warn";
    case "error":
    case "err":
    case "crit":
      return "error";
    case "fatal":
    case "emerg":
    case "alert":
      return "fatal";
    default:
      return "info";
  }
}

/**
 * Create a Winston `format` that gates log records through
 * `quonfig.shouldLog`. Returning `false` from a Winston format drops the
 * record — that's how we implement per-logger dynamic log-level control.
 *
 * `loggerPath` is passed through to `shouldLog` verbatim — no normalization.
 *
 * @example
 * ```ts
 * import winston from "winston";
 * import { Quonfig } from "@quonfig/node";
 * import { createWinstonFormat } from "@quonfig/node/winston";
 *
 * const quonfig = new Quonfig({
 *   sdkKey: process.env.QUONFIG_BACKEND_SDK_KEY!,
 *   loggerKey: "log-level.my-app",
 * });
 * await quonfig.init();
 *
 * const logger = winston.createLogger({
 *   level: "silly", // let Winston emit everything; Quonfig decides.
 *   format: winston.format.combine(
 *     createWinstonFormat(quonfig, "myapp.services.auth"),
 *     winston.format.json()
 *   ),
 *   transports: [new winston.transports.Console()],
 * });
 * ```
 */
export function createWinstonFormat(
  quonfig: Quonfig | BoundQuonfig,
  loggerPath: string,
  options: CreateWinstonFormatOptions = {}
): any {
  // We `require` winston lazily so users who don't depend on winston don't
  // pay for it. winston is declared as an optional peerDependency.
  let winston: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    winston = require("winston");
  } catch {
    throw new Error(
      "[quonfig] createWinstonFormat requires winston. Install it with: npm install winston"
    );
  }

  return winston.format((info: WinstonInfo) => {
    const desiredLevel = winstonLevelToQuonfigLevel(info.level);

    const allowed = quonfig.shouldLog({
      loggerPath,
      desiredLevel,
      defaultLevel: options.defaultLevel,
      contexts: options.contexts,
    });

    // Returning `false` from a Winston format drops the record before any
    // transport sees it — exactly the behavior we want when shouldLog says no.
    return allowed ? info : false;
  })();
}

/**
 * Options accepted by {@link createWinstonLogger}.
 *
 * `loggerOptions` is passed straight to `winston.createLogger`. We set
 * `level: "silly"` by default so Winston emits every record and lets Quonfig
 * decide. Callers can still override any of Winston's native options.
 */
export interface CreateWinstonLoggerOptions extends CreateWinstonFormatOptions {
  loggerOptions?: Record<string, unknown>;
}

/**
 * Convenience constructor that returns a ready-to-use Winston logger whose
 * emissions are gated by Quonfig. Prefer {@link createWinstonFormat} when you
 * already have your own Winston logger to compose into.
 */
export function createWinstonLogger(
  quonfig: Quonfig | BoundQuonfig,
  loggerPath: string,
  options: CreateWinstonLoggerOptions = {}
): any {
  let winston: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    winston = require("winston");
  } catch {
    throw new Error(
      "[quonfig] createWinstonLogger requires winston. Install it with: npm install winston"
    );
  }

  const { loggerOptions = {}, ...formatOptions } = options;

  return winston.createLogger({
    level: "silly",
    defaultMeta: { loggerPath },
    format: winston.format.combine(
      createWinstonFormat(quonfig, loggerPath, formatOptions),
      winston.format.json()
    ),
    transports: [new winston.transports.Console()],
    ...loggerOptions,
  });
}
