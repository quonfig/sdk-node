/**
 * Failover + canonical-ordering chaos runners for sdk-node (bead qfg-7h5d.1.7).
 *
 * Mirrors `sdk-go/failover_chaos_test.go`. Consumes the two shared corpus rigs:
 *
 *   scenarios-failover/ (f01-f05) — ONE fixture upstream behind TWO proxies
 *     (primary 'http' leg + 'secondary' leg). Faults hit the primary leg only;
 *     the SDK must fail the HTTP config fetch over to the secondary and keep
 *     serving, fast (well inside initTimeout). SSE is asserted NOT to repoint.
 *
 *   scenarios-ordering/ (o01-o05) — TWO fixture upstreams pinned to divergent
 *     Meta.generations. Under the parallel-failover hedge (qfg-7h5d.1.14) a fast
 *     primary wins and the secondary is never contacted (o01 cold standby), a
 *     slow newer primary heals forward off a fast older secondary (o03), and a
 *     slow older primary loses to a fast newer secondary without regressing the
 *     late older payload (o05). An established client never regresses to an
 *     older generation (o02); a same-generation second leg is a no-op (o04).
 *
 * Only toxiproxy needs to be running (boot it with run-failover-chaos.sh, which
 * needs no --with-upstream). Each runner spawns its own api-delivery fixture
 * upstream(s) and repoints the 'http'/'secondary'/'sse' proxies at them, so the
 * ordering runner can pin a different generation per scenario.
 *
 * RED baseline (proven at unit level by test/per-url-timeout-failover.test.ts and
 * test/ordering-guard.test.ts):
 *   - f02 (primary hang) is RED without the per-URL config-fetch timeout — a hung
 *     primary starves the secondary until initTimeout. Green with qfg-7h5d.1.7.
 *   - o02 (secondary older) is RED without the reject-older install guard — a
 *     failover fetch of the older secondary regresses the held generation.
 *   - o05 (slow older primary loses to a fast newer secondary) and o01 (fast
 *     primary cold-standby) are RED on the pre-hedge sequential transport; the
 *     parallel-failover hedge (qfg-7h5d.1.14) makes them green. The unit-level
 *     proof lives in test/hedge.test.ts (per-leg request counter).
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as yaml from "js-yaml";

import { Quonfig } from "../src/quonfig";
import type { SSEConnectionState } from "../src/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Host ports the launcher maps the seeded proxies to (must match docker-compose).
const RIG_PRIMARY_PORT = 18551; // 'http' proxy — primary HTTP leg
const RIG_SECONDARY_PORT = 18552; // 'secondary' proxy — secondary HTTP leg
const RIG_SSE_PORT = 18550; // 'sse' proxy — live stream (primary leg only)
const RIG_INIT_TIMEOUT_MS = 8000;
const POLL_MS = Number(envOr("CHAOS_POLL_MS", "200"));

// ----- scenario YAML types -----

interface RigScenario {
  function: string;
  tests: RigRun[];
}
interface RigRun {
  name: string;
  description?: string;
  setup?: RigSetup;
  chaos?: RigEvent[];
  expectations?: RigExpectation[];
}
interface RigSetup {
  sdk?: string;
  topology?: string;
  sse_endpoint?: string;
  http_endpoint?: string;
  wall_clock_seconds?: number;
  upstreams?: RigUpstream[];
}
interface RigUpstream {
  role: string;
  generation: number;
}
interface RigEvent {
  at_ms?: number;
  inject?: RigInject;
}
interface RigInject {
  name?: string;
  primary_refused_ms?: number;
  primary_hang_ms?: number;
  primary_latency_ms?: number;
  sse_down_ms?: number;
}
interface RigExpectation {
  within_ms: number;
  must_hold_for_ms?: number;
  assert: string;
}

// ----- toxiproxy admin client -----

class Toxiproxy {
  constructor(private base: string) {
    this.base = base.replace(/\/$/, "");
  }
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/version`);
      return res.ok;
    } catch {
      return false;
    }
  }
  async upsertProxy(name: string, listen: string, upstream: string): Promise<void> {
    await fetch(`${this.base}/proxies/${name}`, { method: "DELETE" }).catch(() => {});
    const res = await fetch(`${this.base}/proxies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, listen, upstream, enabled: true }),
    });
    if (!res.ok) throw new Error(`upsertProxy ${name}: ${res.status} ${await res.text()}`);
  }
  async clearToxics(proxy: string): Promise<void> {
    const res = await fetch(`${this.base}/proxies/${proxy}/toxics`);
    if (!res.ok) return;
    const list = (await res.json()) as Array<{ name: string }>;
    for (const t of list) {
      await fetch(`${this.base}/proxies/${proxy}/toxics/${t.name}`, { method: "DELETE" }).catch(
        () => {}
      );
    }
  }
  async setEnabled(proxy: string, enabled: boolean): Promise<void> {
    const res = await fetch(`${this.base}/proxies/${proxy}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error(`setEnabled ${proxy}: ${res.status} ${await res.text()}`);
  }
  async addToxic(
    proxy: string,
    name: string,
    type: string,
    stream: string,
    attributes: Record<string, unknown>
  ): Promise<void> {
    const res = await fetch(`${this.base}/proxies/${proxy}/toxics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, stream: stream || "downstream", attributes }),
    });
    if (!res.ok) throw new Error(`addToxic ${proxy}/${name}: ${res.status} ${await res.text()}`);
  }
  async removeToxic(proxy: string, name: string): Promise<void> {
    await fetch(`${this.base}/proxies/${proxy}/toxics/${name}`, { method: "DELETE" }).catch(
      () => {}
    );
  }
}

// ----- SDK probe -----

/**
 * Reads the failover/ordering observability accessors added for this epic
 * (qfg-7h5d.1.7). Nil-safe before the client is constructed.
 */
class RigProbe {
  private client?: Quonfig;
  sseStates: SSEConnectionState[] = [];

  setClient(c: Quonfig): void {
    this.client = c;
  }
  onSSEState(s: SSEConnectionState): void {
    this.sseStates.push(s);
  }
  ready(): boolean {
    return this.client?.ready() ?? false;
  }
  resolvedFrom(): string {
    return this.client?.resolvedFrom() ?? "";
  }
  heldGeneration(): number {
    return this.client?.heldGeneration() ?? 0;
  }
  configInstallCount(): number {
    return this.client?.configInstallCount() ?? 0;
  }
  sseFailedOverToSecondary(): boolean {
    return this.client?.sseFailedOverToSecondary() ?? false;
  }
}

// ----- expression evaluator -----

const RE_READY = /^client\.ready\(\)\s*==\s*(true|false)$/;
const RE_RESOLVED_FROM = /^client\.resolvedFrom\(\)\s*(==|!=)\s*'([^']+)'$/;
const RE_HELD_GEN = /^client\.heldGeneration\(\)\s*(>=|<=|==|!=|<|>)\s*(-?\d+)$/;
const RE_INSTALL_COUNT = /^client\.configInstallCount\(\)\s*(>=|<=|==|!=|<|>)\s*(-?\d+)$/;
const RE_SSE_FAILOVER = /^client\.sseFailedOverToSecondary\(\)\s*==\s*(true|false)$/;

function compareNum(op: string, a: number, b: number): boolean {
  switch (op) {
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
  }
  return false;
}

function evalLeaf(expr: string, probe: RigProbe): { ok: boolean; why: string } {
  expr = expr.trim();
  let m: RegExpExecArray | null;
  if ((m = RE_READY.exec(expr))) {
    const want = m[1] === "true";
    const got = probe.ready();
    return { ok: got === want, why: `ready=${got} want ${want}` };
  }
  if ((m = RE_RESOLVED_FROM.exec(expr))) {
    const [, op, want] = m;
    const got = probe.resolvedFrom();
    const ok = op === "==" ? got === want : got !== want;
    return { ok, why: `resolvedFrom='${got}' ${op} '${want}'` };
  }
  if ((m = RE_HELD_GEN.exec(expr))) {
    const [, op, wantStr] = m;
    const got = probe.heldGeneration();
    return {
      ok: compareNum(op, got, Number(wantStr)),
      why: `heldGeneration=${got} ${op} ${wantStr}`,
    };
  }
  if ((m = RE_INSTALL_COUNT.exec(expr))) {
    const [, op, wantStr] = m;
    const got = probe.configInstallCount();
    return {
      ok: compareNum(op, got, Number(wantStr)),
      why: `configInstallCount=${got} ${op} ${wantStr}`,
    };
  }
  if ((m = RE_SSE_FAILOVER.exec(expr))) {
    const want = m[1] === "true";
    const got = probe.sseFailedOverToSecondary();
    return { ok: got === want, why: `sseFailedOverToSecondary=${got} want ${want}` };
  }
  return { ok: false, why: `unrecognized expression: ${expr}` };
}

function evaluate(expr: string, probe: RigProbe): { ok: boolean; why: string } {
  expr = expr.trim();
  if (!expr) return { ok: true, why: "" };
  if (expr.includes(" AND ")) {
    for (const p of expr.split(" AND ")) {
      const r = evaluate(p, probe);
      if (!r.ok) return { ok: false, why: "AND: " + r.why };
    }
    return { ok: true, why: "" };
  }
  if (expr.includes(" OR ")) {
    const reasons: string[] = [];
    for (const p of expr.split(" OR ")) {
      const r = evaluate(p, probe);
      if (r.ok) return { ok: true, why: "" };
      reasons.push(r.why);
    }
    return { ok: false, why: "OR: " + reasons.join(" | ") };
  }
  return evalLeaf(expr, probe);
}

// ----- helpers -----

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function envOr(k: string, d: string): string {
  const v = process.env[k];
  return v && v.length > 0 ? v : d;
}
function splitCSV(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
function scenarioNumber(filename: string): string {
  const i = filename.indexOf("-");
  return i > 0 ? filename.substring(0, i) : filename;
}
function repoRoot(): string {
  return path.join(__dirname, "..", "..");
}
function failoverScenariosDir(): string {
  return path.join(repoRoot(), "integration-test-data", "chaos", "scenarios-failover");
}
function orderingScenariosDir(): string {
  return path.join(repoRoot(), "integration-test-data", "chaos", "scenarios-ordering");
}

/** Ask the OS for a free TCP port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function dialOK(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => {
      sock.destroy();
      resolve(false);
    });
    sock.setTimeout(500, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

// ----- api-delivery upstream spawning -----

const spawned: ChildProcess[] = [];

function apiBinary(): string {
  const bin = process.env.CHAOS_API_BIN;
  if (!bin) {
    throw new Error(
      "CHAOS_API_BIN not set — run scripts/run-failover-chaos.sh, which builds the api-delivery binary and exports its path"
    );
  }
  if (!fs.existsSync(bin)) throw new Error(`CHAOS_API_BIN does not exist: ${bin}`);
  return bin;
}

/**
 * Spawn a fixture-mode api-delivery on `port`, pinned to `generation` via
 * FIXTURE_GENERATION, and wait for it to listen.
 */
async function spawnUpstream(port: number, generation: number): Promise<void> {
  const root = repoRoot();
  const fixtureDir = path.join(root, "integration-test-data", "data", "integration-tests");
  const keysPath = path.join(root, "api-delivery", "testdata", "fixture-sdk-keys.json");
  if (!fs.existsSync(fixtureDir)) throw new Error(`fixtures not found at ${fixtureDir}`);
  if (!fs.existsSync(keysPath)) throw new Error(`fixture SDK keys not found at ${keysPath}`);

  const child = spawn(apiBinary(), {
    env: {
      ...process.env,
      PORT: String(port),
      FIXTURE_DIR: fixtureDir,
      SDK_KEYS_FILE: keysPath,
      QUONFIG_ENVIRONMENT: "development",
      SSE_HEARTBEAT_INTERVAL: "1s",
      FIXTURE_GENERATION: String(generation),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  spawned.push(child);

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await dialOK("127.0.0.1", port)) {
      await sleep(100);
      return;
    }
    await sleep(50);
  }
  throw new Error(`api-delivery (gen=${generation}) did not start on :${port} within 15s`);
}

function killSpawned(): void {
  for (const c of spawned.splice(0)) {
    c.kill("SIGKILL");
  }
}

// ----- proxy plumbing -----

const UPSTREAM_HOST = envOr("CHAOS_UPSTREAM_HOST", "host.docker.internal");

/** Repoint the seeded proxies at the spawned upstream(s). SSE always tracks the primary. */
async function reconfigureProxies(
  tp: Toxiproxy,
  primaryPort: number,
  secondaryPort: number
): Promise<void> {
  await tp.upsertProxy("http", `0.0.0.0:${RIG_PRIMARY_PORT}`, `${UPSTREAM_HOST}:${primaryPort}`);
  await tp.upsertProxy(
    "secondary",
    `0.0.0.0:${RIG_SECONDARY_PORT}`,
    `${UPSTREAM_HOST}:${secondaryPort}`
  );
  await tp.upsertProxy("sse", `0.0.0.0:${RIG_SSE_PORT}`, `${UPSTREAM_HOST}:${primaryPort}`);
}

/**
 * Map a failover-rig inject alias to a self-restoring toxiproxy action on the
 * primary HTTP leg (or the SSE leg). Each alias carries its own duration in ms,
 * after which a timer clears the fault — so the scenarios need no `clear` event.
 */
async function applyInject(tp: Toxiproxy, inj: RigInject): Promise<void> {
  const name = inj.name || "primary_fault";
  const restoreAfter = (ms: number, fn: () => Promise<void>): void => {
    setTimeout(() => void fn().catch(() => {}), ms).unref();
  };
  if (inj.primary_refused_ms !== undefined) {
    await tp.setEnabled("http", false);
    restoreAfter(inj.primary_refused_ms, () => tp.setEnabled("http", true));
  } else if (inj.primary_hang_ms !== undefined) {
    await tp.addToxic("http", name, "timeout", "downstream", { timeout: inj.primary_hang_ms });
    restoreAfter(inj.primary_hang_ms, () => tp.removeToxic("http", name));
  } else if (inj.primary_latency_ms !== undefined) {
    await tp.addToxic("http", name, "latency", "downstream", { latency: inj.primary_latency_ms });
    restoreAfter(inj.primary_latency_ms, () => tp.removeToxic("http", name));
  } else if (inj.sse_down_ms !== undefined) {
    await tp.setEnabled("sse", false);
    restoreAfter(inj.sse_down_ms, () => tp.setEnabled("sse", true));
  } else {
    console.log(`applyInject: unhandled inject shape ${JSON.stringify(inj)} — no-op`);
  }
}

// ----- runner -----

interface ExpState {
  idx: number;
  exp: RigExpectation;
  hitAt?: number;
  heldSince?: number;
  passed: boolean;
  failed: boolean;
  lastReason: string;
}

/**
 * Stand up a fresh SDK client pointed at [primary, secondary], schedule the
 * scenario's chaos events against the primary leg, optionally drive a refresh
 * loop (ordering rig), then evaluate every expectation on a poll timer.
 */
async function runRigScenario(
  tp: Toxiproxy,
  run: RigRun,
  driveRefresh: boolean
): Promise<{ pass: number; fail: number; details: string[] }> {
  // Clean proxy state — no leftover toxics, all legs enabled.
  for (const p of ["http", "secondary", "sse"]) {
    await tp.clearToxics(p);
    await tp.setEnabled(p, true);
  }

  const probe = new RigProbe();
  const primaryUrl = `http://127.0.0.1:${RIG_PRIMARY_PORT}`;
  const secondaryUrl = `http://127.0.0.1:${RIG_SECONDARY_PORT}`;
  const sseUrl = `http://127.0.0.1:${RIG_SSE_PORT}/api/v2/sse/config`;

  const sseEnabled = run.setup?.sse_endpoint !== undefined && run.setup.sse_endpoint !== "disabled";

  const client = new Quonfig({
    sdkKey: "test-backend-key",
    apiUrls: [primaryUrl, secondaryUrl],
    enableSSE: sseEnabled,
    // Ordering rig drives refresh explicitly; leave the fallback poller off so
    // o04's configInstallCount stays deterministic.
    fallbackPollEnabled: false,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    onNoDefault: "ignore",
    initTimeout: RIG_INIT_TIMEOUT_MS,
    sseReadDeadlineMs: 5000,
    onSSEConnectionStateChange: (s: SSEConnectionState) => probe.onSSEState(s),
  });
  if (sseEnabled) {
    (
      client as unknown as { transport: { __testStreamUrlOverride?: string } }
    ).transport.__testStreamUrlOverride = sseUrl;
  }
  probe.setClient(client);

  const baseline = Date.now();
  const refresh = (): Promise<void> =>
    (client as unknown as { fetchAndInstall(): Promise<void> }).fetchAndInstall();

  // Apply t=0 faults synchronously BEFORE the first fetch, then schedule the
  // rest on timers. This makes the failover suite deterministic: a t=0 primary
  // fault (refused/hang/slow) is in place when the initial fetch runs, so the
  // SDK must fail it over to the secondary rather than racing a healthy primary.
  const deferred: RigEvent[] = [];
  for (const ev of run.chaos ?? []) {
    if (!ev.inject) continue;
    if ((ev.at_ms ?? 0) <= 0) {
      await applyInject(tp, ev.inject);
      console.log(`[0ms] inject ${JSON.stringify(ev.inject)}`);
    } else {
      deferred.push(ev);
    }
  }
  for (const ev of deferred) {
    const at = ev.at_ms ?? 0;
    setTimeout(() => {
      void applyInject(tp, ev.inject!).catch(() => {});
      console.log(`[${at}ms] inject ${JSON.stringify(ev.inject)}`);
    }, at).unref();
  }

  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  if (driveRefresh) {
    // Ordering rig: establish cleanly on the initial fetch first (mirrors the
    // go pilot serializing installs under refreshMu — avoids a double-seed race
    // on configInstallCount), then model ongoing polling. Each refresh re-runs
    // the [primary, secondary] failover fetch; without the reject-older guard a
    // failover to an older secondary regresses the held generation (o02 red).
    await client.init().catch((err) => console.log(`init returned: ${(err as Error).message}`));
    refreshTimer = setInterval(() => void refresh().catch(() => {}), 750);
    refreshTimer.unref();
  } else {
    // Failover rig: don't await init — the t=0 fault must be exercised on the
    // initial fetch, and ready() flips when it resolves off the secondary
    // (mirrors the go pilot's background init goroutine).
    void client.init().catch((err) => console.log(`init returned: ${(err as Error).message}`));
  }

  const wallClock = (run.setup?.wall_clock_seconds ?? 30) * 1000;
  const states: ExpState[] = (run.expectations ?? []).map((e, i) => ({
    idx: i,
    exp: e,
    passed: false,
    failed: false,
    lastReason: "",
  }));

  while (Date.now() - baseline < wallClock) {
    const elapsed = Date.now() - baseline;
    let allTerminal = true;
    for (const s of states) {
      if (s.passed || s.failed) continue;
      const r = evaluate(s.exp.assert, probe);
      s.lastReason = r.why;
      if (r.ok) {
        if (s.heldSince === undefined) {
          s.heldSince = Date.now();
          s.hitAt = elapsed;
        }
        const holdFor = s.exp.must_hold_for_ms ?? 0;
        if (holdFor <= 0 || Date.now() - s.heldSince >= holdFor) s.passed = true;
      } else {
        s.heldSince = undefined;
      }
      if (!s.passed && elapsed > s.exp.within_ms) s.failed = true;
      if (!s.passed && !s.failed) allTerminal = false;
    }
    if (allTerminal) break;
    await sleep(POLL_MS);
  }
  for (const s of states) if (!s.passed) s.failed = true;

  if (refreshTimer) clearInterval(refreshTimer);
  await client.close().catch(() => {});

  const details: string[] = [];
  let pass = 0;
  let fail = 0;
  for (const s of states) {
    if (s.passed) {
      pass++;
      details.push(
        `PASS  exp[${s.idx}] within=${s.exp.within_ms}ms hold=${s.exp.must_hold_for_ms ?? 0}ms: ${s.exp.assert} (hit at ${s.hitAt}ms)`
      );
    } else {
      fail++;
      details.push(
        `FAIL  exp[${s.idx}] within=${s.exp.within_ms}ms hold=${s.exp.must_hold_for_ms ?? 0}ms: ${s.exp.assert} — last: ${s.lastReason}`
      );
    }
  }
  details.push(
    `summary: ${pass} passed, ${fail} failed (ready=${probe.ready()}, resolvedFrom='${probe.resolvedFrom()}', heldGeneration=${probe.heldGeneration()}, installs=${probe.configInstallCount()}, sseFailedOverToSecondary=${probe.sseFailedOverToSecondary()})`
  );
  return { pass, fail, details };
}

function upstreamGenerations(ups: RigUpstream[] | undefined): {
  primary: number;
  secondary: number;
} {
  let primary = 0;
  let secondary = 0;
  for (const u of ups ?? []) {
    if (u.role === "primary") primary = u.generation;
    else if (u.role === "secondary") secondary = u.generation;
  }
  return { primary, secondary };
}

// ----- entry point -----

const TOXI_URL = envOr("TOXIPROXY_URL", "http://127.0.0.1:8474");
const ONLY = splitCSV(process.env.CHAOS_ONLY);
const SKIP = splitCSV(process.env.CHAOS_SKIP);
const tp = new Toxiproxy(TOXI_URL);

function loadScenarios(dir: string): { file: string; scenario: RigScenario }[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => path.join(dir, f))
    .map((file) => ({ file, scenario: yaml.load(fs.readFileSync(file, "utf-8")) as RigScenario }));
}

describe("failover + ordering chaos (qfg-7h5d.1.7)", { timeout: 30 * 60 * 1000 }, () => {
  beforeAll(async () => {
    const ok = await tp.ping();
    if (!ok) {
      throw new Error(
        `toxiproxy not reachable at ${TOXI_URL} — run scripts/run-failover-chaos.sh first to boot the harness`
      );
    }
  });

  afterAll(() => {
    killSpawned();
  });

  // ---- failover suite: ONE upstream behind primary + secondary proxies ----
  describe("scenarios-failover", () => {
    const scenarios = loadScenarios(failoverScenariosDir());
    for (const { file, scenario } of scenarios) {
      const base = path.basename(file);
      const num = scenarioNumber(base);
      if (ONLY.length > 0 && !ONLY.includes(num)) continue;
      if (SKIP.includes(num)) continue;
      describe(base, () => {
        for (const run of scenario.tests) {
          it(run.name, async () => {
            const port = await freePort();
            await spawnUpstream(port, 0);
            await reconfigureProxies(tp, port, port);
            const result = await runRigScenario(tp, run, false);
            for (const line of result.details) console.log(line);
            killSpawned();
            expect(result.fail, `${result.fail} expectation(s) failed`).toBe(0);
          });
        }
      });
    }
  });

  // ---- ordering suite: TWO upstreams pinned to divergent generations ----
  describe("scenarios-ordering", () => {
    const scenarios = loadScenarios(orderingScenariosDir());
    for (const { file, scenario } of scenarios) {
      const base = path.basename(file);
      const num = scenarioNumber(base);
      if (ONLY.length > 0 && !ONLY.includes(num)) continue;
      if (SKIP.includes(num)) continue;
      describe(base, () => {
        for (const run of scenario.tests) {
          it(run.name, async () => {
            const { primary, secondary } = upstreamGenerations(run.setup?.upstreams);
            const primaryPort = await freePort();
            const secondaryPort = await freePort();
            await spawnUpstream(primaryPort, primary);
            await spawnUpstream(secondaryPort, secondary);
            await reconfigureProxies(tp, primaryPort, secondaryPort);
            const result = await runRigScenario(tp, run, true);
            for (const line of result.details) console.log(line);
            killSpawned();
            expect(result.fail, `${result.fail} expectation(s) failed`).toBe(0);
          });
        }
      });
    }
  });
});
