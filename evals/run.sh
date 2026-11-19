#!/usr/bin/env bash
# Run the job-board skill through opencode in a clean Docker container, then build an HTML report.
# Manual only: it calls paid model APIs. Never run it from CI.
set -euo pipefail

ref=HEAD save="" models="" runs=3 concurrency=3 stories="" envfile="" seed="" out=""
usage() {
  cat <<'U'
usage: evals/run.sh --models a,b --env-file FILE [options]
  --models LIST       comma list of opencode model IDs, e.g. openrouter/anthropic/claude-sonnet-5.5
  --env-file FILE     file with provider keys (KEY=value lines), passed to the container, never baked into the image
  --ref REF           git ref whose committed skills/job-board is installed (default HEAD; use origin/main to test what is public)
  --runs N            runs per model and story (default 3)
  --stories S1,S5     only these stories (default all)
  --concurrency N     parallel runs (default 3; Docker Desktop's 2 GB VM runs out of memory at 6)
  --seed N            shuffle seed (default random)
  --out DIR           output directory (default evals/out/<timestamp>)
  --save NAME         also copy summary.md and summary.json to evals/results/<date>-NAME.* (commit these to compare later)
U
  exit 2
}
while [ $# -gt 0 ]; do
  case "$1" in
    --models) models=$2; shift 2 ;; --env-file) envfile=$2; shift 2 ;; --ref) ref=$2; shift 2 ;;
    --runs) runs=$2; shift 2 ;; --stories) stories=$2; shift 2 ;; --concurrency) concurrency=$2; shift 2 ;;
    --seed) seed=$2; shift 2 ;; --save) save=$2; shift 2 ;; --out) out=$2; shift 2 ;; *) usage ;;
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

printf '{"date":"%s","ref":"%s","commit":"%s","name":"%s"}\n' "$(date +%F)" "$ref" "$(git -C "$root" rev-parse --short "$ref")" "${save:-$ref}" > "$out/meta.json"
cid=$(docker create --env-file "$envfile" \
  -e MODELS="$models" -e RUNS="$runs" -e CONCURRENCY="$concurrency" -e SEED="$seed" -e STORIES="$stories" \
  "$tag" node /evals/run.mjs)
trap 'docker rm -f "$cid" >/dev/null 2>&1; rm -rf "$ctx"' EXIT
rc=0
docker start -a "$cid" || rc=$?
docker cp "$cid:/out/." "$out/"
node "$here/report.mjs" "$out"
node "$here/summary.mjs" "$out" >/dev/null
invalid=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).meta.invalidRuns)' "$out/summary.json")
if [ "$invalid" -gt 0 ]; then
  echo "WARNING: $invalid run(s) hit an API error (credit limit, bad key, provider outage) and are excluded from every rate." >&2
  [ -n "$save" ] && echo "Not saving to evals/results/: fix the cause and repeat the run." >&2
elif [ "$rc" -ne 0 ]; then
  echo "WARNING: the runner exited with $rc." >&2
  [ -n "$save" ] && echo "Not saving to evals/results/." >&2
elif [ -n "$save" ]; then
  mkdir -p "$here/results"
  cp "$out/summary.md" "$here/results/$(date +%F)-$save.md"
  cp "$out/summary.json" "$here/results/$(date +%F)-$save.json"
  echo "saved evals/results/$(date +%F)-$save.{md,json}"
fi
echo "open $out/report.html"
exit $(( invalid > 0 || rc != 0 ? 1 : 0 ))
