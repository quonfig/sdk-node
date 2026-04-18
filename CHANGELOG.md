# Changelog

## 0.0.9 - 2026-04-18

- Added `quonfig.getRawMatch()` plus `RawMatch`, `RawConfigWithDependencies`, `RawDependency`, `RawDependencyType`, and `RawEvaluationMetadata` types. Lets callers inspect the matched config row (including `decryptWith` / `providedBy` dependency chain) without resolving `ENV_VAR` or decrypting ciphertext on the caller's host.
- Fixed tsup DTS build regression in `transport.ts` — typed the fetch init as `RequestInit & { cache?: string }` so `dist/index.d.ts` builds and ships with the rest of the public API.

## 0.0.3 - 2026-04-02

- Added `quonfig.flush()` and `boundQuonfig.flush()` to force pending telemetry delivery in short-lived serverless runtimes.
- Fixed dynamic log level resolution so string config values like `"info"` and `"warn"` are parsed correctly by `shouldLog()`.
- Exposed telemetry reporter syncing internally to support manual flushes.
- Added tests covering string log level parsing and telemetry flush behavior.
