# Changelog

## 0.0.14 - 2026-04-22

- Added a `loggerKey` option to the `Quonfig` constructor and a new `shouldLog({loggerPath, desiredLevel, defaultLevel?, contexts?})` overload on both `Quonfig` and `BoundQuonfig`. When `loggerKey` is set (e.g. `"log-level.app-quonfig"`), callers can evaluate per-logger log rules by passing a logical `loggerPath`; the SDK injects it under `contexts["quonfig-sdk-logging"] = { key: loggerPath }` and evaluates the configured `loggerKey`. Because the injected context uses the `key` property, logger paths are auto-captured by the existing example-context telemetry and surface in the dashboard with no extra wiring.

  ```ts
  const quonfig = new Quonfig({
    sdkKey: "...",
    loggerKey: "log-level.app-quonfig",
  });
  await quonfig.init();

  // Evaluates log-level.app-quonfig with the logger path in context.
  if (quonfig.shouldLog({ loggerPath: "com.myapp.Auth", desiredLevel: "DEBUG" })) {
    // ...
  }
  ```

- `loggerPath` is passed through without normalization. Native identifiers such as `"MyApp::Services::Auth"` reach the config evaluator exactly as written — authors write rules against whatever shape they actually log.
- `shouldLog({loggerPath})` throws a clear error if `loggerKey` was not set at init, steering callers to either configure `loggerKey` or use the `configKey` primitive.
- `BoundQuonfig` inherits `loggerKey` from its parent; bound contexts are merged with the injected `quonfig-sdk-logging.key` at call time.
- Exported a new `QUONFIG_SDK_LOGGING_CONTEXT_NAME` constant (value: `"quonfig-sdk-logging"`) for advanced users and test fixtures.

This change is additive and non-breaking: the existing `shouldLog({configKey, ...})` primitive is unchanged and remains the escape hatch when callers want full control over the config key or don't want context injection.

## 0.0.13 - 2026-04-22

- BREAKING: `shouldLog({loggerName})` renamed to `shouldLog({configKey})`. Callers must now pass the full stored key (e.g. `log-level.my-app`) instead of the bare logger name — the SDK no longer auto-prefixes `log-level.`. This matches what users see in the Quonfig UI and aligns with sdk-ruby's API.

  Migration:
  ```ts
  // Before
  quonfig.shouldLog({ loggerName: "my-app", desiredLevel: "info" });
  // After
  quonfig.shouldLog({ configKey: "log-level.my-app", desiredLevel: "info" });
  ```

- Removed the exported `LOG_LEVEL_PREFIX` constant (no longer needed).

## 0.0.9 - 2026-04-18

- Added `quonfig.getRawMatch()` plus `RawMatch`, `RawConfigWithDependencies`, `RawDependency`, `RawDependencyType`, and `RawEvaluationMetadata` types. Lets callers inspect the matched config row (including `decryptWith` / `providedBy` dependency chain) without resolving `ENV_VAR` or decrypting ciphertext on the caller's host.
- Fixed tsup DTS build regression in `transport.ts` — typed the fetch init as `RequestInit & { cache?: string }` so `dist/index.d.ts` builds and ships with the rest of the public API.

## 0.0.3 - 2026-04-02

- Added `quonfig.flush()` and `boundQuonfig.flush()` to force pending telemetry delivery in short-lived serverless runtimes.
- Fixed dynamic log level resolution so string config values like `"info"` and `"warn"` are parsed correctly by `shouldLog()`.
- Exposed telemetry reporter syncing internally to support manual flushes.
- Added tests covering string log level parsing and telemetry flush behavior.
