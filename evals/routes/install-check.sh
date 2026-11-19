#!/usr/bin/env bash
# Prove the job-board skill installs through another agent's own install route, with no model call and no API key.
#   evals/routes/install-check.sh <claude|pi> [--ref REF] [--tar FILE]
# Builds an image whose repo copy is `git archive REF` (committed files only), installs the skill as a non-root user
# with `claude plugin ...` or `pi install`, then runs evals/routes/verify.mjs inside a container from that image.
# Exits 0 only if the install and every check pass. Needs network for npm and docker pulls only.
set -uo pipefail

route=${1:-}; ref=HEAD tar=""
[ "$route" = claude ] || [ "$route" = pi ] || { echo "usage: $0 <claude|pi> [--ref REF] [--tar FILE]" >&2; exit 2; }
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) ref=$2; shift 2 ;;
    --tar) tar=$2; shift 2 ;;   # a ready-made repo archive, used to test a deliberately broken tree
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
ctx=$(mktemp -d); log=$(mktemp)
cleanup() { [ -n "${cid:-}" ] && docker rm -f "$cid" >/dev/null 2>&1; rm -rf "$ctx" "$log"; }
trap cleanup EXIT

if [ -n "$tar" ]; then cp "$tar" "$ctx/repo.tar"; label=$(basename "$tar")
else git -C "$root" archive "$ref" > "$ctx/repo.tar" || { echo "FAIL: cannot archive ref '$ref'" >&2; exit 1; }
     label=$(git -C "$root" rev-parse --short "$ref"); fi
cp "$here/Dockerfile.$route" "$ctx/Dockerfile"
cp "$here/verify.mjs" "$here/run-$route.mjs" "$here/adapt.mjs" "$root/evals/stories.json" "$ctx/"
tag=jb-route-$route:$label

echo "== build $route image for $label (installs the agent, then the skill via its install route)"
if ! docker build -t "$tag" "$ctx" > "$log" 2>&1; then
  echo "FAIL: image build failed. Last lines of the build log:" >&2
  tail -8 "$log" >&2
  echo "FAIL: the $route install route did not complete for $label" >&2
  exit 1
fi
grep -E "Successfully (added|installed)|^Installed |^User packages" "$log" | sed 's/^/   /'

echo "== verify install in a fresh container (no model, no key)"
cid=$(docker create "$tag" node /evals/verify.mjs "$route")
docker start "$cid" >/dev/null
docker logs -f "$cid"
rc=$(docker wait "$cid")
if [ "$rc" != 0 ]; then
  echo "FAIL: $route install check failed for $label (see FAIL lines above)" >&2
  exit 1
fi
echo "PASS: $route route installed and verified for $label"
