# @quonfig/node

Node.js SDK for [Quonfig](https://quonfig.com) — Feature Flags, Live Config, and Dynamic Log Levels.

> **Note:** This SDK is pre-1.0 and the API is not yet stable.

## Installation

```bash
npm install @quonfig/node
```

## Quick Start

```typescript
import { Quonfig } from "@quonfig/node";

const quonfig = new Quonfig({ sdkKey: "your-sdk-key" });
await quonfig.init();

// Feature flags
if (quonfig.isEnabled("new-dashboard")) {
  // show new dashboard
}

// Config values
const limit = quonfig.getNumber("rate-limit");
const regions = quonfig.getStringList("allowed-regions");

// Context-aware evaluation
const value = quonfig.get("homepage-hero", {
  user: { key: "user-123", country: "US" },
});

// Bound context for repeated lookups
const userClient = quonfig.inContext({
  user: { key: "user-123", plan: "pro" },
});
userClient.get("feature-x");
userClient.isEnabled("beta-feature");

// Clean up when done
quonfig.close();
```

> **Migrating from earlier releases:** `isFeatureEnabled` is still available as a deprecated alias
> of `isEnabled` — both behave identically. New code should prefer `isEnabled`, which matches
> `@quonfig/javascript` and `@quonfig/react`.

## Options

```typescript
new Quonfig({
  sdkKey: "your-sdk-key",        // Required (or set QUONFIG_BACKEND_SDK_KEY)
  apiUrls: ["https://primary.quonfig.com", "https://secondary.quonfig.com"],
                                 // Ordered failover list. Defaults are derived
                                 // from QUONFIG_DOMAIN (see below).
  telemetryUrl: "https://telemetry.quonfig.com",
                                 // Default derived from QUONFIG_DOMAIN.
  enableSSE: true,               // Real-time updates via SSE (default: true)
  fallbackPollEnabled: true,     // Engage HTTP polling when SSE is unavailable (default: true)
  fallbackPollIntervalMs: 60000, // Fallback poll interval in ms (default: 60000)
  sseReadDeadlineMs: 90000,      // Drop SSE socket if no chunk arrives within this window
                                 // (default 90000 = 3x the 30s server heartbeat).
  initTimeout: 10000,            // Init timeout in ms (default: 10000)
  onNoDefault: "error",          // "error" | "warn" | "ignore" (default: "error")
  globalContext: { ... },        // Context applied to all evaluations
  datadir: "./workspace-data",   // Load local workspace directories instead of API
  datafile: "./config.json",     // Legacy local envelope path
  dataDirAutoReload: false,      // Opt in to fs.watch-based re-read in datadir mode (default: false)
  dataDirAutoReloadDebounceMs: 200, // Debounce window for the watcher (default: 200)
});
```

## Environment variables

| Variable                  | Purpose                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QUONFIG_BACKEND_SDK_KEY` | Fallback for `sdkKey` when omitted from options.                                                                                                    |
| `QUONFIG_DOMAIN`          | Domain used to derive default `apiUrls` and `telemetryUrl`. Defaults to `quonfig.com`. Set to `quonfig-staging.com` to point everything at staging. |
| `QUONFIG_ENVIRONMENT`     | Environment name to use in datadir mode (overridden by the `environment` option).                                                                   |
| `QUONFIG_DEV_CONTEXT`     | When `true`, injects `quonfig-user.email` from `~/.quonfig/tokens.json`.                                                                            |

Resolution order for URLs (highest wins):

1. Explicit `apiUrls` / `telemetryUrl` option.
2. `QUONFIG_DOMAIN` env var (derives `https://primary.${DOMAIN}`, `https://secondary.${DOMAIN}`,
   `https://telemetry.${DOMAIN}`).
3. Hardcoded default `quonfig.com`.

## SSE: real-time updates

When `enableSSE: true` (the default), the SDK opens a Server-Sent Events stream to
`https://stream.${primary}/api/v2/sse/config` and applies each pushed envelope to the in-memory
store. `get*` calls always read from the in-memory store, so flag reads never block on the network —
they continue returning the last-known values during a disconnect.

### Reconnection behavior

Reconnection is delegated entirely to the [`eventsource`](https://www.npmjs.com/package/eventsource)
library (currently v3.x). The SDK's defaults:

- **Initial reconnect delay:** 1000ms
- **Backoff:** none (constant delay; no exponential growth)
- **Jitter:** none
- **Max retries:** unlimited — the library will retry indefinitely
- **Server-driven delay:** the server can override the delay by sending a `retry: <ms>` field in any
  event (per the W3C EventSource spec)
- **Read deadline (Layer 1, configurable via `sseReadDeadlineMs`):** the SDK wraps the underlying
  `fetch` with an `AbortController` whose deadline resets on every chunk. If no chunk arrives within
  the window (default 90s = 3x the 30s server heartbeat) the socket is dropped and the library
  reconnects. Without this, a silent server-side stall would wait on the OS TCP timeout (often 2+
  hrs).

### HTTP fallback polling (Layer 2)

When SSE is enabled (the default) and `fallbackPollEnabled: true` (the default), the SDK **only
polls when SSE is unavailable**:

- If the initial SSE connection fails (DNS, TLS, HTTP error before any successful onopen), the
  fallback poller engages immediately so you keep receiving updates while the supervisor retries
  SSE.
- If SSE has been disconnected for >= 2x `fallbackPollIntervalMs` (default 120s) without recovering,
  the fallback poller engages.
- When SSE recovers (next successful `connected` transition), the fallback poller stops.

This is a behavior change from earlier releases where `enablePolling: true` ran a parallel poller on
top of SSE (double bandwidth, no reconcile). The old options now map onto the new ones with a
deprecation warning.

### Observing connection health

Pass `onSSEConnectionStateChange` to surface SSE lifecycle transitions to your host application
(logging, metrics, status pages, etc.):

```typescript
const quonfig = new Quonfig({
  sdkKey: process.env.QUONFIG_BACKEND_SDK_KEY!,
  onSSEConnectionStateChange: (state) => {
    // state: "connecting" | "connected" | "error" | "disconnected"
    metrics.gauge("quonfig.sse.state", state);
    if (state === "error") log.warn("Quonfig SSE disconnected; reconnecting…");
  },
});
```

State semantics:

| State          | When it fires                                                          |
| -------------- | ---------------------------------------------------------------------- |
| `connecting`   | `init()` has started SSE; or after an error while the library retries. |
| `connected`    | The SSE stream is open and receiving events.                           |
| `error`        | The transport surfaced an error. The library will auto-reconnect.      |
| `disconnected` | `quonfig.close()` was called.                                          |

The callback is fired only on transitions — duplicate consecutive states are suppressed. During a
disconnect, `get*` calls keep returning the last-known config from the in-memory store.

### Diagnostic health signals

Two getters expose aggregate health for logging, dashboards, and ad-hoc debugging:

```typescript
quonfig.lastSuccessfulRefresh(); // Date | undefined — wall-clock time of the last installed envelope (any source).
quonfig.connectionState();
// "initializing" | "connected" | "disconnected" | "falling_back"
```

| State          | Meaning                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------- |
| `initializing` | `init()` has not yet returned.                                                              |
| `connected`    | SSE is live, or the SDK is running from a local `datadir`/`datafile`.                       |
| `disconnected` | SSE has errored and the fallback grace timer has not elapsed, or `close()` has been called. |
| `falling_back` | The Layer 2 HTTP fallback poller is the active update channel.                              |

> Do not wire `lastSuccessfulRefresh()` or `connectionState()` directly into a Kubernetes liveness
> probe. These signals are diagnostic, not pass/fail. A liveness probe based on SDK freshness will
> amplify transient network blips into restart cascades.

If you need a binary signal in your own observability stack, compose your own threshold from the two
getters (e.g. "warn at 5 min stale, page at 15 min") and feed it into a metric or readiness probe —
never a liveness probe.

## Datadir mode: auto-reload on file changes

When you initialize the SDK with `datadir: "./path"`, configs are loaded once from disk at `init()`
time. Opt in to `dataDirAutoReload` to have the SDK watch the directory and re-read the envelope
whenever files change — an editor save, a `git pull`, or a build step.

```typescript
import { Quonfig } from "@quonfig/node";

const quonfig = new Quonfig({
  datadir: "./workspace-data",
  environment: "development",
  dataDirAutoReload: true, // off by default — must be opted in
  onConfigUpdate: () => {
    console.log("Quonfig configs reloaded from disk");
  },
});
await quonfig.init();

// Edit a file under ./workspace-data and onConfigUpdate fires within ~200ms.

// On shutdown, close() stops the watcher and clears any pending debounce timer.
quonfig.close();
```

### When to enable

- Local development with the datadir checked out from git.
- Self-hosted servers that `git pull` the datadir on a schedule.
- CI jobs that mutate the datadir between assertions.

### When NOT to enable

- **Read-only / immutable filesystems** (some containers, AWS Lambda, scratch images). Watch
  registration may fail; the SDK degrades gracefully (logs the error and continues serving the
  envelope it loaded at `init()` time) but you're paying for nothing.
- **Build-time-embedded workflows** where the datadir is bundled into the artifact and never changes
  at runtime. Watching wastes a file descriptor and a libuv handle.
- **Production paths where reload timing matters** — e.g. you'd rather pin the envelope you shipped
  with and roll forward through a redeploy than have it shift under traffic.

Default is `false`; datadir mode is silent until you opt in.

### Behavior contract

- **Parse-then-swap.** If the new envelope fails to parse (truncated write, mid-`git pull` state,
  invalid JSON), the SDK logs the error and **keeps serving the previous envelope**.
  `onConfigUpdate` is _not_ fired on parse failure — only on a successful swap.
- **Debounced.** Bursts of filesystem events (atomic-rename editor saves, `git pull` touching dozens
  of files) coalesce into a single re-read. Default window: **200ms** — long enough to absorb the
  3–5 events typical editors emit in <50ms, short enough that interactive edits feel immediate. Tune
  via `dataDirAutoReloadDebounceMs` if you need a different window.
- **Graceful degrade.** If watch registration fails (read-only fs, immutable container, EMFILE), the
  SDK logs and continues without watching — it does **not** throw from `init()`.
- **Symlinks.** The watcher resolves `datadir` to its real path at start time. Editing the file the
  symlink points at _is_ detected; atomic flips that retarget the link itself are **not**.
- **Shutdown.** `quonfig.close()` stops the watcher and clears any pending debounce timer. There is
  no separate handle to manage — the watcher lifecycle is tied to the client.

### Tuning the debounce window

```typescript
new Quonfig({
  datadir: "./workspace-data",
  dataDirAutoReload: true,
  dataDirAutoReloadDebounceMs: 1000, // wait a full second after the last event
});
```

The default (200ms) is tuned for interactive editing. Raise it if you have a noisy producer
(continuously regenerating files) and you'd rather see one reload per second than per save. Lower it
only if you've measured that 200ms is meaningfully too slow for your use case.

See the [open-source / local how-to](https://docs.quonfig.com/docs/how-tos/open-source-local) for
the cross-SDK story (sdk-node, sdk-go, sdk-ruby, sdk-python, sdk-java).

## Dynamic log levels with Winston

`winston` is an optional peer dependency. Install it alongside `@quonfig/node`, then compose the
format:

```typescript
import winston from "winston";
import { Quonfig } from "@quonfig/node";
import { createWinstonFormat } from "@quonfig/node/winston";

const quonfig = new Quonfig({
  sdkKey: process.env.QUONFIG_BACKEND_SDK_KEY!,
  loggerKey: "log-level.my-app",
});
await quonfig.init();

const logger = winston.createLogger({
  level: "silly", // let Winston emit everything; Quonfig decides.
  format: winston.format.combine(
    createWinstonFormat(quonfig, "myapp.services.auth"),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

logger.info("live-controlled"); // emits iff shouldLog says so.
```

The `loggerPath` (second arg) is forwarded to `quonfig.shouldLog` verbatim — no normalization — so
rules can key on whatever identifier shape you actually log (`"com.app.Auth"`,
`"MyApp::Services::Auth"`, etc.).

## Dynamic log levels with Pino

`pino` is an optional peer dependency. Install it alongside `@quonfig/node`, then wire the hook:

```typescript
import pino from "pino";
import { Quonfig } from "@quonfig/node";
import { createPinoHooks } from "@quonfig/node/pino";

const quonfig = new Quonfig({
  sdkKey: process.env.QUONFIG_BACKEND_SDK_KEY!,
  loggerKey: "log-level.my-app",
});
await quonfig.init();

const logger = pino({
  level: "trace", // let Pino emit everything; Quonfig decides.
  hooks: createPinoHooks(quonfig, "myapp.services.auth"),
});

logger.debug("live-controlled");
```

Both adapters also ship convenience constructors — `createWinstonLogger` and `createPinoLogger` —
that return a ready-to-use logger with the Quonfig gate already attached.

## License

MIT
