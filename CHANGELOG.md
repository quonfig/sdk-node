# Changelog

## 0.0.23 - 2026-05-02

- Fix: throw a clear error when `sdkKey` is empty in cloud mode instead of failing silently downstream (qfg-zcsj).
- Fix: align `ApiClient` auth header with the Transport — both now send `Authorization: Basic <base64("1:<sdkKey>")>` so REST and SSE auth go through the same code path (qfg-ds7v).
- Test: regression coverage for URL fall-through on transport-layer errors (the SDK now retries the secondary URL when the primary throws, not just on non-2xx responses).

## 0.0.22 - 2026-05-02

- New `domain` init option that flips api + sse + telemetry URLs in lockstep — mirrors the `domain` option added in `@quonfig/javascript@0.0.13`. Resolution order: explicit `apiUrls` / `telemetryUrl` > `options.domain` > `process.env.QUONFIG_DOMAIN` > `"quonfig.com"`. Existing callers using only the env var or only `apiUrls` are unaffected (qfg-ppuc.3).

## 0.0.21 - 2026-05-02

- `close()` now drains pending telemetry before stopping the reporter, and returns a `Promise<void>` instead of `void`. Buffered eval summaries / context shapes that hadn't hit the periodic flush window were previously dropped on clean shutdown — they're now POSTed before the timers stop. Mirrors the `sdk-javascript@0.0.12` contract (qfg-q3cx) and the Go/Ruby/Python "close drains" behavior. Also fixes the OpenFeature provider foot-gun (qfg-vrfm): consumers calling `OpenFeature.close()` no longer silently lose telemetry, even without an explicit `await provider.getClient().flush()`.
- Migration: existing call sites that did `quonfig.close()` synchronously continue to work but no longer block on the drain. To preserve the new behavior, switch to `await quonfig.close()`.

## 0.0.20 - 2026-05-01

- The `X-Quonfig-SDK-Version` telemetry header now reflects the published `package.json` version instead of the hardcoded `node-0.1.0` string. A new `scripts/generate-version.mjs` runs in `prebuild` to write `src/version.ts` from `package.json`, and a regression test in `test/transport.test.ts` asserts the header value matches `package.json` at runtime so future bumps can't drift again.

## 0.0.19 - 2026-05-01

- Replace `QUONFIG_TELEMETRY_URL` with `QUONFIG_DOMAIN` derivation: a single env var now governs api, sse, and telemetry URLs in lockstep, eliminating the silent prod-telemetry mismatch when reading from staging (qfg-3uo8). The explicit `apiUrls` / `telemetryUrl` constructor options still take precedence.

## 0.0.18 - 2026-04-27

- Added `getBoolDetails`, `getStringDetails`, `getNumberDetails`, `getStringListDetails`, and `getJSONDetails` (with `BoundQuonfig` parity), returning `EvaluationDetails<T>` with `reason` in `{STATIC, TARGETING_MATCH, SPLIT, DEFAULT, ERROR}` and an `errorCode` in `{FLAG_NOT_FOUND, TYPE_MISMATCH, GENERAL}` on `ERROR`. Lets callers introspect *why* an evaluation returned what it did without a separate API.
- Fix: `selectedValue` redaction now hashes only the value (not the whole row) and uses the **first** 5 hex chars of the md5 instead of the last 5, matching the cross-SDK redaction spec. Two bugs carried over from the Reforge predecessor.
- Fix: dev-context now reads `~/.quonfig/tokens-<domain-with-dashes>.json` when the SDK is configured against a non-production domain, mirroring `cli/src/util/token-storage.ts:14`. Locally-authenticated agents pointed at staging now get user-scoped evaluation again (qfg-pj0.9).
- Test: added the `dev_overrides` generated suite covering `quonfig-user.email IS_ONE_OF [...]` rules — fires on match, falls through when the attribute is absent (qfg-pj0.7).

## 0.0.17 - 2026-04-26

- Integration test infrastructure: regenerated tests from the unified TS generator and wired aggregator-helpers to real telemetry collectors so cross-SDK suites exercise the actual emission path. No public API changes.
- Telemetry: emit proto-style wrapper keys in `selectedValue` payloads (matches the wire format the server expects).
- Dev experience: dev-context now injects `quonfig-user.email` from `~/.quonfig/tokens.json` when available (qfg-pj0.3), so locally-authenticated agents get user-scoped evaluation without manual context.

## 0.0.16 - 2026-04-24

- Widen `ContextValue` from the scalar union (`string | number | boolean | string[] | null | undefined`) to `unknown`, matching the Reforge SDK's public input shape. Callers can now pass loose context objects (e.g. request payloads containing `Date`, nullable numbers, enum types) without upfront narrowing — the evaluator continues to apply per-operator runtime type checks. Internal storage is unchanged (plain object, not Map). Also exports `ContextObj` as an alias for `Contexts` so generated code emitting `contexts?: Contexts | ContextObj` compiles against this SDK (the CLI `qfg generate --targets node-ts` output was silently broken against 0.0.15 because the narrower `ContextValue` type rejected the generator's local `ContextObj = Record<string, Record<string, unknown>>`).

## 0.0.15 - 2026-04-22

- Added Winston and Pino ecosystem adapters for drop-in dynamic log levels. Both adapters route every emitted record through `quonfig.shouldLog({ loggerPath, desiredLevel, contexts })` — there is no up-front "set the logger's level" phase, so per-logger rules update live as Quonfig config changes without touching the logger instance.

  ```ts
  // Winston
  import winston from "winston";
  import { createWinstonFormat } from "@quonfig/node/winston";
  const logger = winston.createLogger({
    level: "silly",
    format: winston.format.combine(
      createWinstonFormat(quonfig, "myapp.services.auth"),
      winston.format.json()
    ),
    transports: [new winston.transports.Console()],
  });

  // Pino
  import pino from "pino";
  import { createPinoHooks } from "@quonfig/node/pino";
  const logger = pino({
    level: "trace",
    hooks: createPinoHooks(quonfig, "myapp.services.auth"),
  });
  ```

- Exposed four public functions: `createWinstonFormat`, `createWinstonLogger`, `createPinoHooks`, `createPinoLogger`. Formats / hooks are the recommended path; the `*Logger` factories are convenience constructors for greenfield use.
- `winston` and `pino` are declared as **optional peer dependencies** — the main `@quonfig/node` install stays lean, and subpath entries throw a clear error if the matching peer is missing.
- Added subpath exports: `@quonfig/node/winston` and `@quonfig/node/pino`. The main entry point is unchanged.
- `loggerPath` is passed through to `shouldLog` verbatim, preserving the no-normalization guarantee from v0.0.14 across the ecosystem adapters.

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
