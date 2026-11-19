#!/usr/bin/env bash
# Run the job-board skill through opencode in a clean Docker container, then build an HTML report.
# Manual only: it calls paid model APIs. Never run it from CI.
set -euo pipefail

ref=HEAD models="" runs=3 concurrency=4 stories="" envfile="" seed="" out=""
usage() {
  cat <<'U'
usage: evals/run.sh --models a,b --env-file FILE [options]
  --models LIST       comma list of opencode model IDs, e.g. openrouter/anthropic/claude-sonnet-5.5
  --env-file FILE     file with provider keys (KEY=value lines), passed to the container, never baked into the image
  --ref REF           git ref whose committed skills/job-board is installed (default HEAD; use origin/main to test what is public)
  --runs N            runs per model and story (default 3)
  --stories S1,S5     only these stories (default all)
  --concurrency N     parallel runs (default 4)
  --seed N            shuffle seed (default random)
  --out DIR           output directory (default evals/out/<timestamp>)
U
  exit 2
}
while [ $# -gt 0 ]; do
  case "$1" in
    --models) models=$2; shift 2 ;; --env-file) envfile=$2; shift 2 ;; --ref) ref=$2; shift 2 ;;
    --runs) runs=$2; shift 2 ;; --stories) stories=$2; shift 2 ;; --concurrency) concurrency=$2; shift 2 ;;
    --seed) seed=$2; shift 2 ;; --out) out=$2; shift 2 ;; *) usage ;;
  esac
done
[ -n "$models" ] && [ -n "$envfile" ] || usage

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
out=${out:-$here/out/$(date +%Y%m%d-%H%M%S)}
mkdir -p "$out"; out=$(cd "$out" && pwd)
seed=${seed:-$(( RANDOM * 32768 + RANDOM ))}

ctx=$(mktemp -d); trap 'rm -rf "$ctx"' EXIT
git -C "$root" archive "$ref" skills/job-board > "$ctx/skill.tar"
cp "$here/Dockerfile" "$here/stories.json" "$here/run.mjs" "$ctx/"
tag=jb-evals:$(git -C "$root" rev-parse --short "$ref")
docker build -q -t "$tag" "$ctx" >/dev/null

printf '{"date":"%s","ref":"%s","commit":"%s"}\n' "$(date +%F)" "$ref" "$(git -C "$root" rev-parse --short "$ref")" > "$out/meta.json"
cid=$(docker create --env-file "$envfile" \
  -e MODELS="$models" -e RUNS="$runs" -e CONCURRENCY="$concurrency" -e SEED="$seed" -e STORIES="$stories" \
  "$tag" node /evals/run.mjs)
trap 'docker rm -f "$cid" >/dev/null 2>&1; rm -rf "$ctx"' EXIT
docker start -a "$cid" || true
docker cp "$cid:/out/." "$out/"
node "$here/report.mjs" "$out"
echo "open $out/report.html"
