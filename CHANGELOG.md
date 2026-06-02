# Changelog

## 0.0.36 - 2026-06-02

- **Dev-context injection is now default-on (qfg-bw7g.2).** `enableQuonfigUserContext` is now a
  tri-state (`boolean | null`); when left unset it defaults to **on**, gated solely by the presence
  of `~/.quonfig/tokens.json`. The loader no-ops without that file, so this stays inert in
  production (no token file there). Precedence: explicit `enableQuonfigUserContext` option ??
  `QUONFIG_DEV_CONTEXT` env (`true`/`false`) ?? `true`. Set `enableQuonfigUserContext: false` or
  `QUONFIG_DEV_CONTEXT=false` to opt out. Existing callers that passed `true` are unaffected.
- **Bound the telemetry POST with a timeout so `close()` can't hang (qfg-i2ar).** A slow or stalled
  telemetry endpoint could previously block shutdown; the final flush is now time-bounded.

## 0.0.35 - 2026-05-29

- **Warn when an environment pin is set in delivery (SDK-key) mode (qfg-pinh).** When the SDK runs
  against api-delivery with an SDK key, the environment is determined by the key, so the
  `environment` option (or `QUONFIG_ENVIRONMENT`) is ignored. The SDK now logs a one-time WARN in
  that case so the ignored pin is visible rather than silently dropped. Evaluation behavior is
  unchanged — the pin was already correctly ignored; this only surfaces it. Ships with the
  regenerated delivery-wire test gate covering the decided contract.

## 0.0.34 - 2026-05-28

- **Add `withContext`; deprecate `inContext` (qfg-pccq, sdk-1.0-unification).** `Quonfig` and
  `BoundQuonfig` now expose `withContext(ctx)` and `withContext(ctx, fn)` with identical semantics
  to `inContext`. `withContext` is the canonical implementation across all Quonfig SDKs; `inContext`
  is now a thin forwarder marked with JSDoc `@deprecated`. **No runtime warning** — the Prefab-fork
  lineage means there is heavy existing `inContext` usage and a server-boot log line per call would
  be noise. The `inContext` shim is retained through 1.0.0 and removed in 2.0.0. No behavior change
  for existing callers.

## 0.0.33 - 2026-05-21

- **CI/dependency maintenance release — no functional SDK change.** Pins `integration-test-data` to
  `v2026.05.20` and guards the build against stale generated tests (#14); skips the Chaos CI job on
  Dependabot PRs so dependency bumps don't gate on it (`5e69c38`); and applies three Dependabot
  bumps — `actions/setup-go` 5.6.0 → 6.4.0 (#10), `actions/upload-artifact` 4.6.2 → 7.0.1 (#11), and
  the `@types/node` dev dependency 25.6.0 → 25.9.1 (#12). No public API or runtime behavior change.

## 0.0.32 - 2026-05-20

- **Datadir loader coerces int/double config values to numbers at load time (qfg-38sf.8).** Config
  files store `int` and `double` value fields as JSON strings on disk
  (`{"type":"int","value":"123"}`). The datadir loader (`src/datadir.ts`) now walks the raw parsed
  config document and coerces every int/double Value node — anywhere in the doc (`default.rules`,
  `environment.rules`, `criteria`, `weightedValues`, `variants`) — from a string to a real number
  via `parseInt`/`parseFloat`. On parse failure the original string is left untouched (passthrough,
  no throw). This makes the loaded envelope carry real numbers regardless of who consumes it,
  matching the canonical behavior of `api-delivery` and `sdk-go`, whose loaders already coerce at
  load. The downstream `Resolver.unwrapValue` coercion stays in place as defense-in-depth. No public
  API change.

## 0.0.31 - 2026-05-19

- **Remove dead `collectLoggerCounts` option from `InitOptions` (qfg-phab).** The field was declared
  on `InitOptions` but never referenced anywhere in the SDK — a leftover from earlier work that
  silently accepted user input and did nothing. **Typing-level breaking change**: TypeScript callers
  passing `collectLoggerCounts: true | false` will now get a type error. No runtime behavior change;
  the field had no effect either before or after this release. JavaScript callers are unaffected.

## 0.0.30 - 2026-05-19

- **Opt-in datadir auto-reload (qfg-mol-0kr, qfg-zx3y.1).** New `dataDirAutoReload` option (default
  `false`) makes the SDK watch the configured `datadir` via Node's built-in
  `fs.watch({recursive: true})` and re-read the envelope when files change on disk (editor save,
  `git pull`, build step). On a successful re-read the SDK fires the existing `onConfigUpdate`
  callback — no parallel notification path. Behavior contract: **parse-then-swap** (on JSON parse
  error the previous envelope keeps serving reads and the callback does not fire); **debounced** via
  `dataDirAutoReloadDebounceMs` (default 200ms) to coalesce atomic-rename editor bursts and git-pull
  churn into a single reload; **graceful degrade** — if watch registration fails (read-only fs,
  immutable container) the SDK logs and continues without watching rather than throwing;
  **symlinks** are resolved to their real path at start time (editing the file the link points at is
  detected, atomic flips of the link itself are not); `close()` stops the watcher and clears any
  pending debounce timer. No new runtime dependencies. Datadir mode stays silent until callers opt
  in. README documents when to enable vs. when not to (build-time-embedded artifacts, read-only fs,
  prod paths where reload timing matters).

## 0.0.29 - 2026-05-18

- **Telemetry off by default in fully-local mode.** When the SDK is initialized with `datadir` (or
  `datafile`) and **no** `sdkKey`, the telemetry reporter no longer starts. Previously, an
  open-source / no-account consumer pointed at a local Quonfig workspace would still queue
  evaluation summaries and attempt to POST them to `telemetry.quonfig.com` on every `close()` — a
  guaranteed failure with no destination workspace to attribute the data to. The dogfood path
  (datadir/datafile + sdkKey, used by `app-quonfig` / `api-telemetry` to self-report) is unchanged:
  if a key is present, the reporter still starts. Surfaced while writing the
  `docs.quonfig.com/docs/tutorials/nextjs-typescript-local` tutorial; new regression test asserts
  `postTelemetry` is never called when a datafile is loaded without an sdkKey.

## 0.0.28 - 2026-05-14

- **SSE silent-stall fix (Layer 1, qfg-47c2.7).** The SDK now wraps the `eventsource` library's
  underlying `fetch` with an `AbortController` whose deadline resets on every chunk. If no chunk
  arrives within `sseReadDeadlineMs` (default **90s = 3x the 30s server heartbeat**), the socket is
  dropped and the eventsource library reconnects. Previously the SDK relied on the OS TCP timeout
  (often 2+ hours), so a silent server-side stall could go unnoticed for hours.
- **Polling is now a fallback, not a parallel stream (Layer 2, qfg-47c2.7).** New options
  `fallbackPollEnabled` (default `true`) and `fallbackPollIntervalMs` (default `60000`) configure an
  HTTP poll that **only runs when SSE is unavailable** — either because the initial SSE connection
  failed (DNS, TLS, HTTP error before any successful onopen) or because SSE has been disconnected
  for >= 2x the poll interval (default 120s) without recovering. When SSE recovers (next successful
  `connected` transition), the fallback poller stops. The previous `enablePolling` / `pollInterval`
  options are deprecated and now map onto the new options with a deprecation warning; **the behavior
  changes** — those options previously ran a parallel poller on top of SSE (double bandwidth, no
  reconcile logic). Alpha-phase, no semver hold per resolved Q1 in
  `project/plans/sdk-hardening-and-verification.md`.
- **Boot log.** `init()` now emits a single info-level log line announcing the chosen update channel
  (SSE-with-fallback / SSE-only / polling-only / none) so deployers can see the new default at
  startup.
- **Health getters (qfg-47c2.14).** New public methods `lastSuccessfulRefresh()` and
  `connectionState()` expose diagnostic state for composing custom freshness checks. The aggregate
  `ConnectionState` type (`initializing` / `connected` / `disconnected` / `falling_back`) is now
  exported. Diagnostic only — see the README on why these must not be wired into a k8s liveness
  probe.
- **datadir: exclude `schemas/` and reject empty-key files (qfg-2inx).** Files under a workspace's
  `schemas/` directory are no longer loaded as configs, and a config file whose key is empty is
  rejected with a clear error instead of being silently mis-keyed.
- **Chaos harness (qfg-47c2.7, qfg-47c2.29, qfg-47c2.32, qfg-mzg2).** sdk-node ships a chaos-test
  runner under `chaos/` (invoked via `npm run test:chaos` / `npm run chaos`) that drives the
  cross-SDK scenarios in `integration-test-data/chaos/scenarios/` against the SDK via toxiproxy.
  Scenario 07 switched to proxy-disable instead of the `limit_data` toxic; the runner identifies its
  session to the shared chaos lock; and `scripts/run-chaos.sh` boots api-delivery + toxiproxy and
  tears them down on exit. The chaos smoke suite now runs on every push and PR and gates the release
  workflow.
- **Dependencies.** `eventsource` `^3.0.0` → `^4.1.0`; dev deps `typescript` `^5.3.0` → `^6.0.3`
  (tsconfig gains `types: ["node"]` + `ignoreDeprecations: "6.0"` for the TS 6 lib/baseUrl changes),
  `vitest` `^1.0.0` → `^4.1.6` (CI test-matrix floor raised to Node 20.19.0 for vitest 4's rolldown
  binding), `pino` `9.14.0` → `10.3.1`, `@types/node` `^20.11.0` → `^25.6.0`. CI actions
  `actions/checkout` → v6.0.2 and `actions/setup-node` → v6.4.0.

## 0.0.27 - 2026-05-10

- Expose `variant`, `errorMessage`, and `flagMetadata` on `EvaluationDetails`, plumbing internal
  evaluation metadata (`configId`, `configType`, `ruleIndex`, `weightedValueIndex`, `environment`)
  through to the public details API per the cross-SDK spec
  (`project/plans/openfeature-resolution-details.md`). `configType` values are SHOUTY_SNAKE,
  metadata keys are camelCase, and `environment` is read from `QUONFIG_ENVIRONMENT` (qfg-9dbl).
- Add `isEnabled(key, contexts?)` as the canonical flag-check method on both `Quonfig` and
  `BoundQuonfig`, aligning sdk-node with `@quonfig/javascript` and `@quonfig/react`.
  `isFeatureEnabled` remains as a `@deprecated` passthrough so existing callers (including code
  migrated from the Reforge launch SDK) keep working unchanged (qfg-rp6t).
- Bump `engines.node` floor to `>=20.9.0`. Node 18 hit EOL on 2025-04-30, and 20.9.0 is the
  strictest 20.x floor any installed dep currently requires. CI matrix drops Node 18 and pins the
  lowest entry to 20.9.0 (qfg-y7xh).

## 0.0.26 - 2026-05-07

- Add `IS_PRESENT` and `IS_NOT_PRESENT` targeting operators (qfg-7jnb.3). Both are presence-only
  operators — they take only `propertyName` (no `valueToMatch`). `IS_PRESENT(prop)` resolves the
  dotted path against the merged context and returns `true` iff the path resolves AND the value is
  not `null` and not `undefined`. Empty string `""`, `0`, and `false` are intentionally considered
  present (the question is "is the field set", type-agnostic). Missing intermediate keys in dotted
  paths count as not present. `IS_NOT_PRESENT` is the negation. Exported as `OP_IS_PRESENT` /
  `OP_IS_NOT_PRESENT`.

## 0.0.25 - 2026-05-04

- Fix: start the telemetry reporter in datadir/datafile mode. Previously `init()` returned early
  when `datadir` or `datafile` was set and skipped `startTelemetry()`, so dogfood services running
  in datadir mode silently dropped every eval summary even with a valid sdk key. Surfaced while
  wiring the Quonfig dogfood services (app-quonfig, api-telemetry) to send telemetry from
  `our-config/`.

## 0.0.23 - 2026-05-02

- Fix: throw a clear error when `sdkKey` is empty in cloud mode instead of failing silently
  downstream (qfg-zcsj).
- Fix: align `ApiClient` auth header with the Transport — both now send
  `Authorization: Basic <base64("1:<sdkKey>")>` so REST and SSE auth go through the same code path
  (qfg-ds7v).
- Test: regression coverage for URL fall-through on transport-layer errors (the SDK now retries the
  secondary URL when the primary throws, not just on non-2xx responses).

## 0.0.22 - 2026-05-02

- New `domain` init option that flips api + sse + telemetry URLs in lockstep — mirrors the `domain`
  option added in `@quonfig/javascript@0.0.13`. Resolution order: explicit `apiUrls` /
  `telemetryUrl` > `options.domain` > `process.env.QUONFIG_DOMAIN` > `"quonfig.com"`. Existing
  callers using only the env var or only `apiUrls` are unaffected (qfg-ppuc.3).

## 0.0.21 - 2026-05-02

- `close()` now drains pending telemetry before stopping the reporter, and returns a `Promise<void>`
  instead of `void`. Buffered eval summaries / context shapes that hadn't hit the periodic flush
  window were previously dropped on clean shutdown — they're now POSTed before the timers stop.
  Mirrors the `sdk-javascript@0.0.12` contract (qfg-q3cx) and the Go/Ruby/Python "close drains"
  behavior. Also fixes the OpenFeature provider foot-gun (qfg-vrfm): consumers calling
  `OpenFeature.close()` no longer silently lose telemetry, even without an explicit
  `await provider.getClient().flush()`.
- Migration: existing call sites that did `quonfig.close()` synchronously continue to work but no
  longer block on the drain. To preserve the new behavior, switch to `await quonfig.close()`.

## 0.0.20 - 2026-05-01

- The `X-Quonfig-SDK-Version` telemetry header now reflects the published `package.json` version
  instead of the hardcoded `node-0.1.0` string. A new `scripts/generate-version.mjs` runs in
  `prebuild` to write `src/version.ts` from `package.json`, and a regression test in
  `test/transport.test.ts` asserts the header value matches `package.json` at runtime so future
  bumps can't drift again.

## 0.0.19 - 2026-05-01

- Replace `QUONFIG_TELEMETRY_URL` with `QUONFIG_DOMAIN` derivation: a single env var now governs
  api, sse, and telemetry URLs in lockstep, eliminating the silent prod-telemetry mismatch when
  reading from staging (qfg-3uo8). The explicit `apiUrls` / `telemetryUrl` constructor options still
  take precedence.

## 0.0.18 - 2026-04-27

- Added `getBoolDetails`, `getStringDetails`, `getNumberDetails`, `getStringListDetails`, and
  `getJSONDetails` (with `BoundQuonfig` parity), returning `EvaluationDetails<T>` with `reason` in
  `{STATIC, TARGETING_MATCH, SPLIT, DEFAULT, ERROR}` and an `errorCode` in
  `{FLAG_NOT_FOUND, TYPE_MISMATCH, GENERAL}` on `ERROR`. Lets callers introspect _why_ an evaluation
  returned what it did without a separate API.
- Fix: `selectedValue` redaction now hashes only the value (not the whole row) and uses the
  **first** 5 hex chars of the md5 instead of the last 5, matching the cross-SDK redaction spec. Two
  bugs carried over from the Reforge predecessor.
- Fix: dev-context now reads `~/.quonfig/tokens-<domain-with-dashes>.json` when the SDK is
  configured against a non-production domain, mirroring `cli/src/util/token-storage.ts:14`.
  Locally-authenticated agents pointed at staging now get user-scoped evaluation again (qfg-pj0.9).
- Test: added the `dev_overrides` generated suite covering `quonfig-user.email IS_ONE_OF [...]`
  rules — fires on match, falls through when the attribute is absent (qfg-pj0.7).

## 0.0.17 - 2026-04-26

- Integration test infrastructure: regenerated tests from the unified TS generator and wired
  aggregator-helpers to real telemetry collectors so cross-SDK suites exercise the actual emission
  path. No public API changes.
- Telemetry: emit proto-style wrapper keys in `selectedValue` payloads (matches the wire format the
  server expects).
- Dev experience: dev-context now injects `quonfig-user.email` from `~/.quonfig/tokens.json` when
  available (qfg-pj0.3), so locally-authenticated agents get user-scoped evaluation without manual
  context.

## 0.0.16 - 2026-04-24

- Widen `ContextValue` from the scalar union
  (`string | number | boolean | string[] | null | undefined`) to `unknown`, matching the Reforge
  SDK's public input shape. Callers can now pass loose context objects (e.g. request payloads
  containing `Date`, nullable numbers, enum types) without upfront narrowing — the evaluator
  continues to apply per-operator runtime type checks. Internal storage is unchanged (plain object,
  not Map). Also exports `ContextObj` as an alias for `Contexts` so generated code emitting
  `contexts?: Contexts | ContextObj` compiles against this SDK (the CLI
  `qfg generate --targets node-ts` output was silently broken against 0.0.15 because the narrower
  `ContextValue` type rejected the generator's local
  `ContextObj = Record<string, Record<string, unknown>>`).

## 0.0.15 - 2026-04-22

- Added Winston and Pino ecosystem adapters for drop-in dynamic log levels. Both adapters route
  every emitted record through `quonfig.shouldLog({ loggerPath, desiredLevel, contexts })` — there
  is no up-front "set the logger's level" phase, so per-logger rules update live as Quonfig config
  changes without touching the logger instance.

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

- Exposed four public functions: `createWinstonFormat`, `createWinstonLogger`, `createPinoHooks`,
  `createPinoLogger`. Formats / hooks are the recommended path; the `*Logger` factories are
  convenience constructors for greenfield use.
- `winston` and `pino` are declared as **optional peer dependencies** — the main `@quonfig/node`
  install stays lean, and subpath entries throw a clear error if the matching peer is missing.
- Added subpath exports: `@quonfig/node/winston` and `@quonfig/node/pino`. The main entry point is
  unchanged.
- `loggerPath` is passed through to `shouldLog` verbatim, preserving the no-normalization guarantee
  from v0.0.14 across the ecosystem adapters.

## 0.0.14 - 2026-04-22

- Added a `loggerKey` option to the `Quonfig` constructor and a new
  `shouldLog({loggerPath, desiredLevel, defaultLevel?, contexts?})` overload on both `Quonfig` and
  `BoundQuonfig`. When `loggerKey` is set (e.g. `"log-level.app-quonfig"`), callers can evaluate
  per-logger log rules by passing a logical `loggerPath`; the SDK injects it under
  `contexts["quonfig-sdk-logging"] = { key: loggerPath }` and evaluates the configured `loggerKey`.
  Because the injected context uses the `key` property, logger paths are auto-captured by the
  existing example-context telemetry and surface in the dashboard with no extra wiring.

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

- `loggerPath` is passed through without normalization. Native identifiers such as
  `"MyApp::Services::Auth"` reach the config evaluator exactly as written — authors write rules
  against whatever shape they actually log.
- `shouldLog({loggerPath})` throws a clear error if `loggerKey` was not set at init, steering
  callers to either configure `loggerKey` or use the `configKey` primitive.
- `BoundQuonfig` inherits `loggerKey` from its parent; bound contexts are merged with the injected
  `quonfig-sdk-logging.key` at call time.
- Exported a new `QUONFIG_SDK_LOGGING_CONTEXT_NAME` constant (value: `"quonfig-sdk-logging"`) for
  advanced users and test fixtures.

This change is additive and non-breaking: the existing `shouldLog({configKey, ...})` primitive is
unchanged and remains the escape hatch when callers want full control over the config key or don't
want context injection.

## 0.0.13 - 2026-04-22

- BREAKING: `shouldLog({loggerName})` renamed to `shouldLog({configKey})`. Callers must now pass the
  full stored key (e.g. `log-level.my-app`) instead of the bare logger name — the SDK no longer
  auto-prefixes `log-level.`. This matches what users see in the Quonfig UI and aligns with
  sdk-ruby's API.

  Migration:

  ```ts
  // Before
  quonfig.shouldLog({ loggerName: "my-app", desiredLevel: "info" });
  // After
  quonfig.shouldLog({ configKey: "log-level.my-app", desiredLevel: "info" });
  ```

- Removed the exported `LOG_LEVEL_PREFIX` constant (no longer needed).

## 0.0.9 - 2026-04-18

- Added `quonfig.getRawMatch()` plus `RawMatch`, `RawConfigWithDependencies`, `RawDependency`,
  `RawDependencyType`, and `RawEvaluationMetadata` types. Lets callers inspect the matched config
  row (including `decryptWith` / `providedBy` dependency chain) without resolving `ENV_VAR` or
  decrypting ciphertext on the caller's host.
- Fixed tsup DTS build regression in `transport.ts` — typed the fetch init as
  `RequestInit & { cache?: string }` so `dist/index.d.ts` builds and ships with the rest of the
  public API.

## 0.0.3 - 2026-04-02

- Added `quonfig.flush()` and `boundQuonfig.flush()` to force pending telemetry delivery in
  short-lived serverless runtimes.
- Fixed dynamic log level resolution so string config values like `"info"` and `"warn"` are parsed
  correctly by `shouldLog()`.
- Exposed telemetry reporter syncing internally to support manual flushes.
- Added tests covering string log level parsing and telemetry flush behavior.
