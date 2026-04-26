import { readFileSync } from "fs";
import * as os from "os";
import { join } from "path";

import type { Contexts } from "./types";

/**
 * Reads ~/.quonfig/tokens.json (written by `qfg login`) and returns
 * { "quonfig-user": { email } } when a userEmail is present. Returns
 * undefined when the file is missing, unreadable, or has no userEmail.
 *
 * The attribute is dev-only by construction: production servers do not
 * run `qfg login` and therefore have no tokens file. Rules keyed on
 * `quonfig-user.email` are dead code in prod.
 */
export function loadQuonfigUserContext(): Contexts | undefined {
  const path = join(os.homedir(), ".quonfig", "tokens.json");

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
