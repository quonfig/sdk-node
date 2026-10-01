// Client factory for the generated integration tests (integration-test-data
// node target, qfg-2agi.32). This module BUILDS public `Quonfig` clients and
// captures what the real telemetry reporter POSTs; it never evaluates a
// config itself. Every assertion in a generated test goes through the same
// public API a customer calls.

import * as fs from "fs";
import * as path from "path";
import { Quonfig } from "../../src/quonfig";
import type { QuonfigOptions } from "../../src/types";
import { startTelemetryStub } from "../helpers/telemetryStub";

// Environment variables the integration-test fixtures reference.
process.env.PREFAB_INTEGRATION_TEST_ENCRYPTION_KEY =
  "c87ba22d8662282abe8a0e4651327b579cb64a454ab0f4c170b45b15f049a221";
process.env.IS_A_NUMBER = "1234";
process.env.NOT_A_NUMBER = "not_a_number";
delete process.env.MISSING_ENV_VAR;

export const DATA_DIR = path.resolve(
  __dirname,
  "../../../integration-test-data/data/integration-tests"
);

if (!fs.existsSync(DATA_DIR)) {
  throw new Error(
    `[integration tests] fixtures not found at ${DATA_DIR} — ` +
      `this directory is required. Ensure the integration-test-data repo ` +
      `(and its nested data/integration-tests submodule) is populated.`
  );
}

export const ENVIRONMENT = "Production";

/**
 * Options every integration client shares: the fixture datadir, no network,
 * and no `~/.quonfig` dev-context injection (a developer's `qfg login` token
 * would otherwise add a `quonfig-user` context to every evaluation).
 */
const HERMETIC: QuonfigOptions = {
  sdkKey: "test-unused",
  datadir: DATA_DIR,
  environment: ENVIRONMENT,
  enableSSE: false,
  enablePolling: false,
  enableQuonfigUserContext: false,
};

/** Eval clients send no telemetry. */
const NO_TELEMETRY: Partial<QuonfigOptions> = {
  collectEvaluationSummaries: false,
  contextUploadMode: "none",
};

let shared: Promise<Quonfig> | undefined;

/** The customer-default client (SDK defaults, e.g. `onNoDefault: "error"`). */
function sharedClient(): Promise<Quonfig> {
  if (!shared) {
    const client = new Quonfig({ ...HERMETIC, ...NO_TELEMETRY });
    shared = client.init().then(() => client);
  }
  return shared;
}

/**
 * Run `fn` against a public client. `{}` reuses the customer-default client;
 * any option (`onNoDefault`, `globalContext`) builds a fresh client with it,
 * closed afterwards.
 */
export async function withClient(
  options: Partial<QuonfigOptions>,
  fn: (client: Quonfig) => void | Promise<void>
): Promise<void> {
  if (Object.keys(options).length === 0) {
    await fn(await sharedClient());
    return;
  }
  const client = new Quonfig({ ...HERMETIC, ...NO_TELEMETRY, ...options });
  await client.init();
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

/** Set `vars` in process.env for the duration of `fn`, then restore them. */
export async function withEnv(
  vars: Record<string, string>,
  fn: () => void | Promise<void>
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ---- Telemetry -------------------------------------------------------------

/**
 * A config that exists in the fixtures. Contexts only reach the telemetry
 * collectors through an evaluation, so context_shape / example_contexts cases
 * evaluate this key once per context record.
 */
export const TELEMETRY_PROBE_KEY = "brand.new.string";

/**
 * Build a telemetry-enabled public client pointed at an in-process telemetry
 * endpoint, run `fn`, then `close()` the client so the real reporter drains.
 * Returns the parsed JSON body of every POST the reporter made.
 */
export async function collectTelemetry(
  options: Partial<QuonfigOptions>,
  fn: (client: Quonfig) => void | Promise<void>
): Promise<any[]> {
  const stub = await startTelemetryStub();
  try {
    const client = new Quonfig({ ...HERMETIC, telemetryUrl: stub.url, ...options });
    await client.init();
    try {
      await fn(client);
    } finally {
      await client.close();
    }
    const posted: any[] = [];
    for (let i = 0; i < stub.postCount(); i++) posted.push(stub.json(i));
    return posted;
  } finally {
    await stub.close();
  }
}

/**
 * Project the reporter's POSTed payloads onto the YAML `expected_data` shape
 * for one aggregator. Pure renaming (camelCase wire -> snake_case YAML); the
 * values all come from the payload, except that a redacted `selectedValue`
 * (confidential / decryptWith) carries no plaintext, so the YAML's runtime
 * `value` for it is what the public getter returned (`observed`).
 */
export function telemetryPost(
  posted: any[],
  kind: "evaluation_summary" | "context_shape" | "example_contexts",
  observed: Map<string, unknown>
): unknown {
  const events: any[] = posted.flatMap((p) => (Array.isArray(p?.events) ? p.events : []));

  if (kind === "context_shape") {
    const shapes = events.flatMap((e) => e.contextShapes?.shapes ?? []);
    if (shapes.length === 0) return undefined;
    return shapes.map((s: any) => ({ name: s.name, field_types: s.fieldTypes }));
  }

  if (kind === "example_contexts") {
    const examples = events.flatMap((e) => e.exampleContexts?.examples ?? []);
    if (examples.length === 0) return undefined;
    const out: Record<string, unknown> = {};
    for (const c of examples[0].contextSet.contexts) out[c.type] = c.values;
    return out;
  }

  const summaries = events.flatMap((e) => e.summaries?.summaries ?? []);
  if (summaries.length === 0) return undefined;
  // YAML lists summaries grouped by config type (CONFIG, FEATURE_FLAG, ...),
  // insertion order within a type.
  const sorted = [...summaries].sort((a, b) =>
    configType(a.type) < configType(b.type) ? -1 : configType(a.type) > configType(b.type) ? 1 : 0
  );
  const out: unknown[] = [];
  for (const s of sorted) {
    for (const counter of s.counters) {
      const selected = counter.selectedValue;
      const redacted = isRedacted(selected);
      const value = redacted ? observed.get(s.key) : unwrapSelected(selected);
      const summary: Record<string, number> = {
        config_row_index: counter.configRowIndex,
        conditional_value_index: counter.conditionalValueIndex,
      };
      if (typeof counter.weightedValueIndex === "number" && counter.weightedValueIndex >= 0) {
        summary.weighted_value_index = counter.weightedValueIndex;
      }
      const record: Record<string, unknown> = {
        key: s.key,
        type: configType(s.type),
        value,
        value_type: redacted ? valueType(value) : wireValueType(selected),
        count: counter.count,
        reason: counter.reason,
        summary,
      };
      if (selected !== undefined && selected !== null) record.selected_value = selected;
      out.push(record);
    }
  }
  return out;
}

const REDACTED = /^\*{5}[0-9a-f]{5}$/;

function isRedacted(selected: unknown): boolean {
  return (
    selected !== null &&
    typeof selected === "object" &&
    typeof (selected as Record<string, unknown>).string === "string" &&
    REDACTED.test((selected as Record<string, string>).string)
  );
}

function unwrapSelected(selected: unknown): unknown {
  if (selected === null || selected === undefined || typeof selected !== "object") {
    return selected;
  }
  const entries = Object.entries(selected as Record<string, unknown>);
  return entries.length === 1 ? entries[0]![1] : selected;
}

/** The wire wrapper key (`bool`, `int`, `double`, `string`, `stringList`) in YAML spelling. */
function wireValueType(selected: unknown): string {
  const key =
    selected !== null && typeof selected === "object" ? Object.keys(selected)[0] : undefined;
  return key === "stringList" ? "string_list" : String(key);
}

function valueType(v: unknown): string {
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "double";
  if (Array.isArray(v)) return "string_list";
  return "string";
}

function configType(internal: string): string {
  return String(internal).toUpperCase();
}
