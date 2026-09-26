import type { ConfigEnvelope } from "./types";

/**
 * Validate that a decoded network payload is a config envelope before it gets
 * anywhere near the install guard (qfg-9dxb.3 Fix B, qfg-4k7d).
 *
 * The rule is deliberately minimal: a `meta` object with a non-empty string
 * `version`. api-delivery always sends `version` + `environment`; `qfg serve`
 * sends the same but no `generation`, and must keep installing through the
 * unversioned carve-out — so `generation` is NOT required here. A misbehaving
 * proxy/WAF answering 200 with `{}` or `{"error":"..."}` fails this check.
 *
 * Returns the payload typed as an envelope, or throws a descriptive Error:
 * on HTTP the throw becomes a failed leg (hedge/failover proceed, the ETag is
 * not stored); on SSE the event is dropped like malformed JSON.
 */
export function parseConfigEnvelope(body: unknown): ConfigEnvelope {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("invalid config payload: not a JSON object");
  }
  const meta = (body as { meta?: unknown }).meta;
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    throw new Error("invalid config payload: missing meta object");
  }
  const version = (meta as { version?: unknown }).version;
  if (typeof version !== "string" || version === "") {
    throw new Error("invalid config payload: missing meta.version");
  }
  return body as ConfigEnvelope;
}
