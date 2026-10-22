#!/usr/bin/env bash
#
# Fail when the workflows check out integration-test-data at different refs
# (qfg-6vno.7). The unit suite (test.yaml), the chaos suite (chaos.yaml) and
# the failover suite (failover-chaos.yaml) must all run against the same ITD
# tag, or a chaos pin can drift behind the unit pin unnoticed.
#
# Usage: scripts/check-itd-refs.sh [workflows-dir]   (default .github/workflows)

set -euo pipefail

DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.github/workflows}"

# For each `repository: quonfig/integration-test-data` checkout, print
# "<file> <ref>" for the first `ref:` that follows it in the same step.
refs="$(
  for f in "$DIR"/*.yml "$DIR"/*.yaml; do
    [[ -f "$f" ]] || continue
    awk -v file="$(basename "$f")" '
      /repository:[[:space:]]*quonfig\/integration-test-data[[:space:]]*$/ { want = 1; next }
      want && /^[[:space:]]*-[[:space:]]/ { print file " MISSING"; want = 0 }
      want && /^[[:space:]]*ref:/ {
        ref = $0; sub(/^[[:space:]]*ref:[[:space:]]*/, "", ref); sub(/[[:space:]]*(#.*)?$/, "", ref)
        print file " " ref; want = 0
      }
      END { if (want) print file " MISSING" }
    ' "$f"
  done
)"

if [[ -z "$refs" ]]; then
  echo "check-itd-refs: no integration-test-data checkout found in $DIR" >&2
  exit 1
fi

echo "integration-test-data refs:"
echo "$refs" | sed 's/^/  /'

if echo "$refs" | grep -q " MISSING$"; then
  echo "::error::an integration-test-data checkout has no ref: pin (it would follow main)" >&2
  exit 1
fi

distinct="$(echo "$refs" | awk '{print $2}' | sort -u)"
if [[ "$(echo "$distinct" | wc -l | tr -d ' ')" != "1" ]]; then
  echo "::error::integration-test-data refs differ across workflows: $(echo "$distinct" | tr '\n' ' ')- pin every checkout to the same tag" >&2
  exit 1
fi
echo "check-itd-refs: all pinned to $distinct"
