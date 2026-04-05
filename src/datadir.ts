import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

import type { ConfigEnvelope, ConfigResponse, QuonfigDatadirEnvironments, WorkspaceConfigDocument } from "./types";

const CONFIG_SUBDIRS = ["configs", "feature-flags", "segments", "schemas", "log-levels"] as const;

export function loadEnvelopeFromDatadir(datadir: string, environment: string): ConfigEnvelope {
  const environmentId = resolveEnvironment(join(datadir, "environments.json"), environment);
  const configs: ConfigResponse[] = [];

  for (const subdir of CONFIG_SUBDIRS) {
    const dir = join(datadir, subdir);
    if (!existsSync(dir)) {
      continue;
    }

    const filenames = readdirSync(dir)
      .filter((filename) => filename.endsWith(".json"))
      .sort((a, b) => a.localeCompare(b));

    for (const filename of filenames) {
      const raw = JSON.parse(readFileSync(join(dir, filename), "utf-8")) as WorkspaceConfigDocument;
      configs.push(toConfigResponse(raw, environmentId));
    }
  }

  return {
    configs,
    meta: {
      version: `datadir:${datadir}`,
      environment: environmentId,
    },
  };
}

function resolveEnvironment(environmentsPath: string, environment: string): string {
  if (!environment) {
    throw new Error(
      "[quonfig] Environment required for datadir mode; set the `environment` option or QUONFIG_ENVIRONMENT env var"
    );
  }

  if (!existsSync(environmentsPath)) {
    throw new Error(`[quonfig] Datadir is missing environments.json: ${environmentsPath}`);
  }

  const environments = JSON.parse(readFileSync(environmentsPath, "utf-8")) as
    | QuonfigDatadirEnvironments
    | { environments?: QuonfigDatadirEnvironments };

  const candidates = normalizeEnvironmentCandidates(
    isWrappedEnvironmentList(environments) ? environments.environments : environments
  );

  // If environments.json defines a non-empty list, validate that the requested environment is in it
  if (candidates.length > 0 && !candidates.includes(environment)) {
    throw new Error(
      `[quonfig] Environment "${environment}" not found in workspace; available environments: ${candidates.join(", ")}`
    );
  }

  return environment;
}

function isWrappedEnvironmentList(
  value: QuonfigDatadirEnvironments | { environments?: QuonfigDatadirEnvironments }
): value is { environments?: QuonfigDatadirEnvironments } {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "environments" in value
  );
}

function normalizeEnvironmentCandidates(environments: QuonfigDatadirEnvironments | undefined): string[] {
  if (!environments) {
    return [];
  }

  if (Array.isArray(environments)) {
    return environments
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object") {
          return entry.id ?? entry.name;
        }
        return undefined;
      })
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  }

  if (environments && typeof environments === "object") {
    const values = Object.values(environments)
      .map((value) => (typeof value === "string" && value.length > 0 ? value : undefined))
      .filter((value): value is string => typeof value === "string");

    if (values.length > 0) {
      return values;
    }

    return Object.keys(environments).filter((key) => key.length > 0);
  }

  return [];
}

function toConfigResponse(raw: WorkspaceConfigDocument, environmentId: string): ConfigResponse {
  const environment = raw.environments?.find((candidate) => candidate.id === environmentId);

  return {
    id: raw.id ?? "",
    key: raw.key,
    type: raw.type,
    valueType: raw.valueType,
    sendToClientSdk: raw.sendToClientSdk ?? false,
    default: raw.default ?? { rules: [] },
    environment,
  };
}
