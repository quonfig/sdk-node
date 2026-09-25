import type { Logger } from "../../src/sdkLogger";

export type Level = "debug" | "info" | "warn" | "error";

export interface CaptureLogger extends Required<Logger> {
  lines: { level: Level; msg: string }[];
  logCount(level: Level, re?: RegExp): number;
  clear(): void;
}

/** A logger that records every line with its level (the contract's `log_count`). */
export function captureLogger(): CaptureLogger {
  const lines: { level: Level; msg: string }[] = [];
  const push =
    (level: Level) =>
    (message: string, ...args: unknown[]): void => {
      lines.push({ level, msg: [message, ...args.map((a) => String(a))].join(" ") });
    };
  return {
    lines,
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
    logCount: (level, re = /.*/) => lines.filter((l) => l.level === level && re.test(l.msg)).length,
    clear: () => {
      lines.length = 0;
    },
  };
}
