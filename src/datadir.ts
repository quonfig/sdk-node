import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

import type { ConfigEnvelope, ConfigResponse, QuonfigDatadirEnvironments, WorkspaceConfigDocument } from "./types";

const CONFIG_SUBDIRS = ["configs", "feature-flags", "segments", "schemas", "log-levels"] as const;

export function loadEnvelopeFromDatadir(datadir: string, environment: string): ConfigEnvelope {
  const environmentId = resolveEnvironment(join(datadir, "quonfig.json"), environment);
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

function resolveEnvironment(quonfigPath: string, environment: string): string {
  if (!environment) {
    throw new Error(
      "[quonfig] Environment required for datadir mode; set the `environment` option or QUONFIG_ENVIRONMENT env var"
    );
  }

  if (!existsSync(quonfigPath)) {
    throw new Error(`[quonfig] Datadir is missing quonfig.json: ${quonfigPath}`);
  }

  const { environments } = JSON.parse(readFileSync(quonfigPath, "utf-8")) as QuonfigDatadirEnvironments;

  // If quonfig.json defines a non-empty list, validate that the requested environment is in it
  if (environments.length > 0 && !environments.includes(environment)) {
    throw new Error(
      `[quonfig] Environment "${environment}" not found in workspace; available environments: ${environments.join(", ")}`
    );
  }

  return environment;
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
