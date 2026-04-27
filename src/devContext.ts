import { readFileSync } from "fs";
import * as os from "os";
import { join } from "path";

import type { Contexts } from "./types";

/**
 * Picks the per-domain tokens file written by `qfg login`, mirroring
 * cli/src/util/token-storage.ts:14. The CLI writes to `tokens.json` only
 * when QUONFIG_DOMAIN=quonfig.com (the default); any other domain (e.g.
 * quonfig-staging.com) is suffixed (`tokens-quonfig-staging-com.json`).
 * The SDK derives the domain from the first configured apiUrl by stripping
 * a leading "app." or "primary." subdomain. An empty list, an unparseable
 * URL, or a host that resolves to quonfig.com falls back to plain
 * `tokens.json`.
 */
export function tokenFilenameForApiUrls(apiUrls?: string[]): string {
  const domain = deriveDomainFromApiUrls(apiUrls);
  if (!domain || domain === "quonfig.com") {
    return "tokens.json";
  }
  return `tokens-${domain.replaceAll(".", "-")}.json`;
}

function deriveDomainFromApiUrls(apiUrls?: string[]): string {
  if (!apiUrls || apiUrls.length === 0 || !apiUrls[0]) {
    return "";
  }
  let host: string;
  try {
    host = new URL(apiUrls[0]).hostname;
  } catch {
    return "";
  }
  if (!host) return "";
  for (const prefix of ["app.", "primary."]) {
    if (host.startsWith(prefix)) {
      return host.slice(prefix.length);
    }
  }
  return host;
}

/**
 * Reads the per-domain tokens file written by `qfg login` (~/.quonfig/tokens.json
 * for production, or ~/.quonfig/tokens-<domain-with-dashes>.json for non-prod
 * domains) and returns { "quonfig-user": { email } } when a userEmail is
 * present. Returns undefined when the file is missing, unreadable, or has no
 * userEmail.
 *
 * The attribute is dev-only by construction: production servers do not
 * run `qfg login` and therefore have no tokens file. Rules keyed on
 * `quonfig-user.email` are dead code in prod.
 */
export function loadQuonfigUserContext(apiUrls?: string[]): Contexts | undefined {
  const path = join(os.homedir(), ".quonfig", tokenFilenameForApiUrls(apiUrls));

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }

  let parsed: { userEmail?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(
      `[quonfig] dev-context: could not parse ${path} (${(err as Error).message}); skipping injection`
    );
    return undefined;
  }

  const email = parsed.userEmail;
  if (typeof email !== "string" || email.length === 0) {
    return undefined;
  }

  return { "quonfig-user": { email } };
}
