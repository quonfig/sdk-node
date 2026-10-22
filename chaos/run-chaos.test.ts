/**
 * Cross-SDK chaos harness — sdk-node runner (qfg-47c2.7).
 *
 * Drives the scenarios in `integration-test-data/chaos/scenarios/` against the
 * SDK via toxiproxy. Mirrors `sdk-go/chaos_test.go` from qfg-47c2.4 — the
 * scenario YAML, expression vocabulary, and expectation polling all match.
 *
 * Run via `npm run test:chaos` (which invokes `scripts/run-chaos.sh` to boot
 * toxiproxy + api-delivery first).
 *
 * Environment knobs:
 *   TOXIPROXY_URL           admin API base       (default http://127.0.0.1:8474)
 *   CHAOS_SSE_PORT          chaos SSE port       (default 18550)
 *   CHAOS_HTTP_PORT         chaos HTTP port      (default 18551)
 *   CHAOS_API_DELIVERY_URL  upstream api-delivery URL (set by run-chaos.sh)
 *   CHAOS_UPSTREAM_HOST     toxiproxy upstream hostname (default host.docker.internal)
 *   CHAOS_ONLY              comma list of scenario numbers to run, e.g. "01,02"
 *   CHAOS_SKIP              comma list of scenario numbers to skip
 *   CHAOS_POLL_MS           expectation poll interval (default 250)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import * as yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { Quonfig } from "../src/quonfig";
import { evaluate } from "./expressions";
import { ChaosProbe } from "./probe";
import {
  isTerminal,
  loadExpectations,
  newTimelineState,
  stepExpectation,
  type ChaosExpectation,
  type TimelineState,
} from "./timeline";

// ----- scenario YAML types -----

interface ChaosScenario {
  function: string;
  tests: ChaosScenarioRun[];
}
interface ChaosScenarioRun {
  name: string;
  description?: string;
  setup?: ChaosSetup;
  chaos?: ChaosEvent[];
  expectations?: unknown;
}
interface ChaosSetup {
  sdk?: string;
  sse_endpoint?: string;
  http_endpoint?: string;
  wall_clock_seconds?: number;
  user_callback?: string;
  // Init-failure scenarios (00-*), ITD chaos README "Init-failure vocabulary".
  on_init_failure?: "fail" | "wait" | "continue";
  init_timeout_ms?: number;
  catch_init_failure?: boolean;
}
interface ChaosEvent {
  at_ms?: number;
  inject?: ChaosInject;
  clear?: string;
  process?: ChaosProc;
}
interface ChaosInject {
  name?: string;
  sse_silent_stall_after_ms?: number;
  sse_latency_ms?: number;
  sse_bandwidth_kbps?: number;
  sse_down_ms?: number;
  both_down_ms?: number;
  sse_half_open_after_bytes?: number;
  sse_http_status?: number;
  proxy?: string;
  toxic?: { type?: string; attributes?: Record<string, unknown> };
}
interface ChaosProc {
  action: string;
  count?: number;
  interval_ms?: number;
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
    if (!res.ok) throw new Error(`clearToxics ${proxy}: ${res.status} ${await res.text()}`);
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
    const res = await fetch(`${this.base}/proxies/${proxy}/toxics/${name}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`removeToxic ${proxy}/${name}: ${res.status} ${await res.text()}`);
  }
}

// ----- chaos injection plan -----

interface InjectionState {
  proxy?: string;
  toxic?: string;
  enable?: string[];
}

// An inject this runner cannot apply throws, and the scenario fails: a fault
// that silently did nothing would let the run pass on healthy-client checks
// (qfg-6vno.2).
async function applyInject(tp: Toxiproxy, inj: ChaosInject): Promise<InjectionState> {
  const name = inj.name || "anon";
  if (inj.sse_silent_stall_after_ms !== undefined) {
    await tp.addToxic("sse", name, "timeout", "downstream", {
      timeout: inj.sse_silent_stall_after_ms,
    });
    return { proxy: "sse", toxic: name };
  }
  if (inj.sse_latency_ms !== undefined) {
    await tp.addToxic("sse", name, "latency", "downstream", { latency: inj.sse_latency_ms });
    return { proxy: "sse", toxic: name };
  }
  if (inj.sse_bandwidth_kbps !== undefined) {
    await tp.addToxic("sse", name, "bandwidth", "downstream", { rate: inj.sse_bandwidth_kbps });
    return { proxy: "sse", toxic: name };
  }
  if (inj.sse_down_ms !== undefined) {
    await tp.setEnabled("sse", false);
    return { enable: ["sse"] };
  }
  if (inj.both_down_ms !== undefined) {
    await tp.setEnabled("sse", false);
    await tp.setEnabled("http", false);
    return { enable: ["sse", "http"] };
  }
  if (inj.sse_half_open_after_bytes !== undefined) {
    // Toxiproxy is TCP-only and can't truly model "server returns 200 then
    // closes after N bytes" — the limit_data toxic this used to call only
    // trips on the NEXT upstream byte, which for SSE is the 30s heartbeat,
    // outside the typical within_ms=15s window. The closest TCP-only analog
    // is to disable the proxy: existing SSE connections drop, new attempts
    // are refused. Leave it disabled until the matching `clear` step so the
    // SDK's reconnect attempts fail visibly (sdk-ruby's ld-eventsource only
    // fires on_error on ECONNREFUSED, not on clean FIN). qfg-47c2.29.
    await tp.setEnabled("sse", false);
    return { enable: ["sse"] };
  }
  if (inj.sse_http_status !== undefined) {
    // toxiproxy is TCP-only, so it cannot answer with an HTTP status. That
    // needs the HTTP-aware fault proxy (scenarios-http-proxy/), which this
    // runner does not drive.
    throw new Error(
      `inject sse_http_status=${inj.sse_http_status} is not supported by this toxiproxy (TCP-only) runner`
    );
  }
  if (inj.proxy && inj.toxic) {
    await tp.addToxic(
      inj.proxy,
      name,
      String(inj.toxic.type),
      "downstream",
      inj.toxic.attributes || {}
    );
    return { proxy: inj.proxy, toxic: name };
  }
  throw new Error(`unknown inject shape ${JSON.stringify(inj)}`);
}

async function clearInject(tp: Toxiproxy, st: InjectionState): Promise<void> {
  if (st.toxic && st.proxy) await tp.removeToxic(st.proxy, st.toxic);
  for (const p of st.enable ?? []) await tp.setEnabled(p, true);
}

async function applyProcess(tp: Toxiproxy, p: ChaosProc): Promise<void> {
  if (p.action === "kill_sse_proxy") {
    const count = p.count ?? 1;
    const interval = p.interval_ms ?? 1000;
    for (let i = 0; i < count; i++) {
      await tp.setEnabled("sse", false);
      await sleep(200);
      await tp.setEnabled("sse", true);
      if (i < count - 1) await sleep(interval - 200);
    }
  } else {
    throw new Error(`unknown process action ${JSON.stringify(p.action)}`);
  }
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

function chaosScenariosDir(): string {
  return path.join(__dirname, "..", "..", "integration-test-data", "chaos", "scenarios");
}

// ----- runner -----

function afterLabel(exp: ChaosExpectation): string {
  return exp.after_ms ? ` after=${exp.after_ms}ms` : "";
}

interface ExpectationState extends TimelineState {
  idx: number;
  // Unevaluable leaves of this expectation, each with its reason.
  skippedLeaves: string[];
}

async function runScenario(
  tp: Toxiproxy,
  run: ChaosScenarioRun,
  expectations: ChaosExpectation[],
  apiUrl: string,
  ssePort: number,
  pollMs: number
): Promise<{
  pass: number;
  fail: number;
  skipped: string[];
  details: string[];
  chaosErrors: string[];
}> {
  await tp.clearToxics("sse");
  await tp.clearToxics("http");
  await tp.setEnabled("sse", true);
  await tp.setEnabled("http", true);

  const probe = new ChaosProbe();
  const apiHttp = `http://127.0.0.1:18551`;
  const sseUrl = `http://127.0.0.1:${ssePort}/api/v2/sse/config`;

  const initMode = run.setup?.on_init_failure;
  const opts: any = {
    sdkKey: "test-backend-key",
    apiUrls: [apiHttp],
    enableSSE: true,
    fallbackPollEnabled: true,
    fallbackPollIntervalMs: 60000,
    // Use a 60s SSE read deadline for chaos scenarios. Production default is
    // 90s = 3x the 30s server heartbeat. We compress slightly to keep the
    // silent-stall scenarios (02, ~95s expectation window) reachable while
    // staying comfortably above the 30s heartbeat so baseline scenarios
    // (01, 03, 11) don't see spurious deadline trips.
    sseReadDeadlineMs: 60000,
    initTimeout: 15000,
    onNoDefault: "warn",
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    onConfigUpdate: () => {
      // readyEventCount(): callbacks after the init call returned or raised.
      if (probe.initState === "returned" || probe.initState === "raised") probe.readyEvents++;
      if (run.setup?.user_callback === "throw") {
        // Throw on every invocation. The SDK supervisor MUST catch this (Tier 1
        // supervisor contract Test 5; chaos scenario 10). If the SDK does not
        // catch, init() rejects and the test detects via the surrounding
        // try/catch — processCrashed flips true.
        throw new Error("simulated user-callback throw for chaos scenario 10");
      }
    },
    logger: {
      debug: (m: string, ...args: unknown[]) => probe.log("debug", `${m} ${args.join(" ")}`),
      info: (m: string, ...args: unknown[]) => probe.log("info", `${m} ${args.join(" ")}`),
      warn: (m: string, ...args: unknown[]) => probe.log("warn", `${m} ${args.join(" ")}`),
      error: (m: string, ...args: unknown[]) => probe.log("error", `${m} ${args.join(" ")}`),
    },
  };
  if (initMode !== undefined) {
    opts.onInitFailure = initMode;
    if (run.setup?.init_timeout_ms !== undefined) opts.initTimeout = run.setup.init_timeout_ms;
  }
  // Test seam: route SSE to chaos port without DNS trickery.
  // Build the client first then reach into transport.
  const quonfig = new Quonfig(opts);
  (quonfig as any).transport.__testStreamUrlOverride = sseUrl;
  probe.attach(quonfig);
  probe.getString = (key, dflt) => {
    const v = quonfig.get(key, undefined, dflt);
    return v === undefined ? dflt : String(v);
  };

  // t=0 (README "Timeline rules", rule 2): init() is awaited (blocking), so the
  // baseline is taken BEFORE it and the initial fetch falls inside the window;
  // the [0] "connected within N" rows include init. Every at_ms, after_ms and
  // within_ms counts from here. Pre-init injects (at_ms <= 0) are applied
  // before the first fetch; the rest are scheduled relative to t=0.
  const baseline = Date.now();
  const wallClock = (run.setup?.wall_clock_seconds ?? 30) * 1000;

  const injectionStates: Record<string, InjectionState> = {};
  // A chaos event that fails or is not understood fails the scenario: the
  // fault never happened, so a pass would be on a healthy client.
  const chaosErrors: string[] = [];
  const fire = async (ev: ChaosEvent): Promise<void> => {
    const at = ev.at_ms ?? 0;
    try {
      if (ev.inject) {
        const st = await applyInject(tp, ev.inject);
        if (ev.inject.name) injectionStates[ev.inject.name] = st;
        console.log(`[${at}ms] inject ${JSON.stringify(ev.inject)}`);
      } else if (ev.clear) {
        const st = injectionStates[ev.clear];
        if (!st) throw new Error(`clear ${ev.clear}: no applied inject with that name`);
        await clearInject(tp, st);
        delete injectionStates[ev.clear];
        console.log(`[${at}ms] clear ${ev.clear}`);
      } else if (ev.process) {
        await applyProcess(tp, ev.process);
        console.log(`[${at}ms] process ${JSON.stringify(ev.process)}`);
      } else {
        throw new Error(`unknown chaos event ${JSON.stringify(ev)}`);
      }
    } catch (err) {
      const msg = `[${at}ms] chaos event failed: ${(err as Error).message}`;
      console.log(msg);
      chaosErrors.push(msg);
    }
  };
  for (const ev of run.chaos ?? []) {
    if ((ev.at_ms ?? 0) <= 0) await fire(ev);
  }
  for (const ev of run.chaos ?? []) {
    const at = ev.at_ms ?? 0;
    if (at <= 0) continue;
    setTimeout(() => void fire(ev), Math.max(0, at - (Date.now() - baseline))).unref();
  }

  if (initMode !== undefined) {
    // Init-failure scenarios: the init call runs in the background so the
    // tick loop keeps evaluating while it blocks; initState reports it.
    probe.initState = "pending";
    quonfig.init().then(
      () => {
        probe.initState = "returned";
      },
      (err) => {
        probe.initState = "raised";
        if (!run.setup?.catch_init_failure) probe.processCrashed = true;
        probe.log("error", `init raised: ${(err as Error).message}`);
      }
    );
  } else {
    try {
      await quonfig.init();
    } catch (err) {
      probe.processCrashed = true;
      probe.log("error", `init failed: ${(err as Error).message}`);
    }
  }

  const states: ExpectationState[] = expectations.map((e, i) => ({
    ...newTimelineState(e),
    idx: i,
    skippedLeaves: [],
  }));

  while (Date.now() - baseline < wallClock) {
    const elapsed = Date.now() - baseline;
    let allTerminal = true;
    for (const s of states) {
      const r = stepExpectation(s, () => evaluate(s.exp.assert, probe), elapsed, Date.now());
      if (r) s.skippedLeaves = r.skipped;
      if (!isTerminal(s)) allTerminal = false;
    }
    if (allTerminal) break;
    await sleep(pollMs);
  }

  // Anything still pending = failure.
  for (const s of states) if (!s.passed && !s.skipped) s.failed = true;

  // Read the summary before close(), which reports disconnected.
  const counters = quonfig.supervisorCounters();
  const summaryState = `state=${probe.connState}, restartLayer1=${counters.workerRestartsLayer1}, connectAttempts=${counters.sseConnectAttempts}, fallback=${probe.fallbackActive}, lastRefreshMs=${probe.lastRefresh}`;
  await quonfig.close().catch(() => {});

  const details: string[] = [];
  let pass = 0;
  let fail = 0;
  let skippedCount = 0;
  const skipped: string[] = [];
  for (const s of states) {
    for (const leaf of s.skippedLeaves) skipped.push(`exp[${s.idx}] SKIPPED ${leaf}`);
    const partial =
      s.skippedLeaves.length > 0 ? ` [SKIPPED leaf: ${s.skippedLeaves.join("; ")}]` : "";
    if (s.skipped) {
      skippedCount++;
      details.push(
        `SKIP  exp[${s.idx}] within=${s.exp.within_ms}ms hold=${s.exp.must_hold_for_ms ?? 0}ms${afterLabel(s.exp)}: ${s.exp.assert} — ${s.lastReason}`
      );
    } else if (s.passed) {
      pass++;
      details.push(
        `PASS  exp[${s.idx}] within=${s.exp.within_ms}ms hold=${s.exp.must_hold_for_ms ?? 0}ms${afterLabel(s.exp)}: ${s.exp.assert} (hit at ${s.hitAt}ms)${partial}`
      );
    } else {
      fail++;
      details.push(
        `FAIL  exp[${s.idx}] within=${s.exp.within_ms}ms hold=${s.exp.must_hold_for_ms ?? 0}ms${afterLabel(s.exp)}: ${s.exp.assert} — last: ${s.lastReason}${partial}`
      );
    }
  }
  for (const e of chaosErrors) details.push(`FAIL  chaos: ${e}`);
  details.push(
    `summary: ${pass} passed, ${fail} failed, ${skippedCount} skipped, ${chaosErrors.length} chaos event error(s) (${summaryState})`
  );
  return { pass, fail, skipped, details, chaosErrors };
}

// ----- entry point -----

const TOXI_URL = envOr("TOXIPROXY_URL", "http://127.0.0.1:8474");
const SSE_PORT = Number(envOr("CHAOS_SSE_PORT", "18550"));
const POLL_MS = Number(envOr("CHAOS_POLL_MS", "250"));
const ONLY = splitCSV(process.env.CHAOS_ONLY);
const SKIP = splitCSV(process.env.CHAOS_SKIP);

const tp = new Toxiproxy(TOXI_URL);

// Run-end tally of every expression leaf the rig could not evaluate, so a skip
// is never silent (qfg-goi1.1.2).
const skipTally: string[] = [];

const scenariosDir = chaosScenariosDir();
const files = fs
  .readdirSync(scenariosDir)
  .filter((f) => f.endsWith(".yaml"))
  .sort()
  .map((f) => path.join(scenariosDir, f));

describe("chaos harness (qfg-47c2.7)", { timeout: 30 * 60 * 1000 }, () => {
  it("toxiproxy is reachable", async () => {
    const ok = await tp.ping();
    if (!ok) {
      throw new Error(
        `toxiproxy not reachable at ${TOXI_URL} — run scripts/run-chaos.sh first to boot the harness + api-delivery`
      );
    }
    // Reconfigure proxies to point at the locally-running api-delivery (set by run-chaos.sh).
    const apiURL = process.env.CHAOS_API_DELIVERY_URL;
    if (!apiURL) {
      throw new Error(
        "CHAOS_API_DELIVERY_URL not set — run-chaos.sh exports this after starting api-delivery"
      );
    }
    const upstreamHost = envOr("CHAOS_UPSTREAM_HOST", "host.docker.internal");
    const upstreamPort = Number(new URL(apiURL).port);
    await tp.upsertProxy("sse", "0.0.0.0:18550", `${upstreamHost}:${upstreamPort}`);
    await tp.upsertProxy("http", "0.0.0.0:18551", `${upstreamHost}:${upstreamPort}`);
  });

  afterAll(() => {
    console.log(`skipped expressions: ${skipTally.length}`);
    for (const line of skipTally) console.log(`  ${line}`);
  });

  for (const file of files) {
    const base = path.basename(file);
    const num = scenarioNumber(base);
    if (ONLY.length > 0 && !ONLY.includes(num)) continue;
    if (SKIP.includes(num)) continue;
    const scenario = yaml.load(fs.readFileSync(file, "utf-8")) as ChaosScenario;
    describe(base, () => {
      for (const run of scenario.tests) {
        // Rule 4: an unknown expectation key fails the run at load, naming it.
        const expectations = loadExpectations(run.expectations, `${base} / ${run.name}`);
        it(run.name, async () => {
          const apiURL = process.env.CHAOS_API_DELIVERY_URL!;
          const result = await runScenario(tp, run, expectations, apiURL, SSE_PORT, POLL_MS);
          for (const line of result.details) console.log(line);
          for (const leaf of result.skipped) skipTally.push(`${base} / ${run.name}: ${leaf}`);
          expect(result.chaosErrors, "chaos event(s) failed or were not understood").toEqual([]);
          expect(result.fail, `${result.fail} expectation(s) failed`).toBe(0);
        });
      }
    });
  }
});
