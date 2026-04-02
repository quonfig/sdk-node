import type { Contexts, GetValue, LogLevelName, LogLevelNumber } from "./types";

export const LOG_LEVEL_PREFIX = "log-level.";

const VALID_LOG_LEVEL_NAMES: readonly LogLevelName[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const;

const WORD_LEVEL_LOOKUP: Record<LogLevelName, LogLevelNumber> = {
  trace: 1,
  debug: 2,
  info: 3,
  warn: 5,
  error: 6,
  fatal: 9,
};

const NUMBER_LEVEL_LOOKUP: Record<LogLevelNumber, LogLevelName> = {
  1: "trace",
  2: "debug",
  3: "info",
  5: "warn",
  6: "error",
  9: "fatal",
};

/**
 * Convert a log level name to its numeric value.
 */
export function wordLevelToNumber(level: LogLevelName): LogLevelNumber | undefined {
  return WORD_LEVEL_LOOKUP[level];
}

/**
 * Parse a log level (string name or number) to a numeric value.
 */
export function parseLevel(level: string | number | undefined): LogLevelNumber | undefined {
  if (typeof level === "number") {
    return level as LogLevelNumber;
  }
  if (typeof level === "string") {
    // Try as a log level name
    const lower = level.toLowerCase() as LogLevelName;
    if (WORD_LEVEL_LOOKUP[lower] !== undefined) {
      return WORD_LEVEL_LOOKUP[lower];
    }
    // Try as a number string (e.g., from config values)
    const n = parseInt(level, 10);
    if (!isNaN(n) && NUMBER_LEVEL_LOOKUP[n as LogLevelNumber] !== undefined) {
      return n as LogLevelNumber;
    }
  }
  return undefined;
}

/**
 * Check if a log message at desiredLevel should be logged, given the logger hierarchy.
 *
 * Walks up the logger name hierarchy (e.g., "log-level.a.b.c" -> "log-level.a.b" -> "log-level.a")
 * looking for a matching config. If no config is found, uses defaultLevel.
 */
export function shouldLog(args: {
  loggerName: string;
  desiredLevel: LogLevelNumber;
  defaultLevel: LogLevelNumber;
  getConfig: (key: string) => GetValue;
}): boolean {
  const { loggerName, desiredLevel, defaultLevel, getConfig } = args;

  let loggerNameWithPrefix = LOG_LEVEL_PREFIX + loggerName;

  while (loggerNameWithPrefix.includes(".")) {
    const resolvedLevel = getConfig(loggerNameWithPrefix);

    if (resolvedLevel !== undefined) {
      const resolvedLevelNum = parseLevel(resolvedLevel as string | number);
      if (resolvedLevelNum !== undefined) {
        return resolvedLevelNum <= desiredLevel;
      }
    }

    loggerNameWithPrefix = loggerNameWithPrefix.slice(
      0,
      loggerNameWithPrefix.lastIndexOf(".")
    );
  }

  return defaultLevel <= desiredLevel;
}
