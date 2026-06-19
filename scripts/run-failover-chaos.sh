#!/usr/bin/env bash
#
# Run the failover + canonical-ordering chaos rigs against sdk-node (bead qfg-7h5d.1.7).
#
# Mirrors sdk-go/scripts/run-failover-chaos.sh. Unlike run-chaos.sh (single
# upstream), these two rigs spawn their own api-delivery fixture upstream(s) from
# inside the vitest runner:
#   - scenarios-failover/ run against ONE upstream behind the primary ('http') +
#     'secondary' proxies; faults hit the primary leg.
#   - scenarios-ordering/ run against TWO upstreams pinned to divergent
#     Meta.generations (one per scenario).
#
# So this wrapper only boots toxiproxy and builds the api-delivery binary; the
# runner repoints the 'http'/'secondary'/'sse' proxies at the upstreams it spawns.
#
# Env knobs:
#   CHAOS_ONLY   comma list of scenario numbers to run, e.g. "f02,o02"
#   CHAOS_SKIP   comma list of scenario numbers to skip (default none — the
#                parallel-failover hedge makes the full o01-o05 suite green)
#   CHAOS_POLL_MS  expectation poll interval (default 200)
#
# Examples:
#   ./scripts/run-failover-chaos.sh
#   CHAOS_ONLY=f02 ./scripts/run-failover-chaos.sh   # the hang-failover scenario only
#   CHAOS_ONLY=o02 ./scripts/run-failover-chaos.sh   # the reject-older scenario only

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$SDK_DIR/.." && pwd)"
HARNESS_DIR="$REPO_ROOT/integration-test-data/chaos"

if [[ ! -d "$HARNESS_DIR" ]]; then
  echo "chaos harness not found at $HARNESS_DIR — is integration-test-data checked out as a sibling?" >&2
  exit 1
fi

# Identify ourselves to the shared chaos lock (qfg-47c2.32). Owner PID is THIS
# wrapper's pid so the lock survives the whole run, not just the short-lived
# start-chaos.sh subprocess.
export QUONFIG_CHAOS_SESSION="${QUONFIG_CHAOS_SESSION:-sdk-node-failover-$$-$(date +%s)}"
export QUONFIG_CHAOS_OWNER_PID=$$

# The parallel-failover hedge (qfg-7h5d.1.14) makes the full ordering suite
# (o01-o05) green, so nothing is skipped by default. Set CHAOS_SKIP to a
# comma list to skip specific scenarios. We use ${CHAOS_SKIP-} (not :-) so an
# explicitly-set empty value from the workflow stays empty.
export CHAOS_SKIP="${CHAOS_SKIP-}"

cleanup_done=0
cleanup() {
  if [[ "$cleanup_done" == "1" ]]; then
    return
  fi
  cleanup_done=1
  echo "==> tearing down chaos harness"
  "$HARNESS_DIR/stop-chaos.sh" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "==> building api-delivery binary"
API_BIN="$SDK_DIR/.chaos-api-delivery"
( cd "$REPO_ROOT/api-delivery" && GOWORK=off go build -o "$API_BIN" ./cmd/server )
export CHAOS_API_BIN="$API_BIN"

echo "==> booting toxiproxy via shared launcher (no upstream — the runner spawns its own)"
"$HARNESS_DIR/start-chaos.sh"

echo "==> running failover + ordering scenarios (skip=${CHAOS_SKIP:-<none>})"
cd "$SDK_DIR"
npm run chaos:failover -- "$@"
