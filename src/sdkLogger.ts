/**
 * Pluggable logger interface for SDK-internal warnings and errors.
 *
 * Shape matches Pino, Winston, Bunyan, and `console` so host apps can pass
 * their existing logger instance without writing an adapter. `warn` and
 * `error` are required; `debug` and `info` are optional and become no-ops
 * when the supplied logger does not implement them.
 */
export interface Logger {
  debug?(message: string, ...args: unknown[]): void;
  info?(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Internal logger shape with every method present and non-optional.
 * Produced by {@link normalizeLogger}.
 */
export interface NormalizedLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const NOOP = (): void => {};

const PREFIX = "[quonfig]";

function prefix(message: string): string {
  return `${PREFIX} ${message}`;
}

function defaultSdkLogger(): NormalizedLogger {
  return {
    debug: (message, ...args) => console.debug(prefix(message), ...args),
    info: (message, ...args) => console.info(prefix(message), ...args),
    warn: (message, ...args) => console.warn(prefix(message), ...args),
    error: (message, ...args) => console.error(prefix(message), ...args),
  };
}

/**
 * Normalize a user-supplied {@link Logger} (or undefined) into a
 * {@link NormalizedLogger} that always implements every level.
 *
 * - `undefined` -> default console wrapper that prefixes `[quonfig]`.
 * - User-supplied logger -> passthrough; missing `debug`/`info` become no-ops.
 *
 * The default wrapper preserves byte-identical output to the historical
 * `console.warn("[quonfig] ...", ...)` callsites: it passes `[quonfig]` as
 * the first arg to `console.warn`, so `console`'s space-joining produces the
 * same string.
 */
export function normalizeLogger(logger: Logger | undefined): NormalizedLogger {
  if (!logger) return defaultSdkLogger();
  return {
    debug: logger.debug ? logger.debug.bind(logger) : NOOP,
    info: logger.info ? logger.info.bind(logger) : NOOP,
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger),
  };
}
