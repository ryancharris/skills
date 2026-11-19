#!/usr/bin/env bash
# Run the job-board skill through Claude Code or pi, each installed by its own install route, in a clean Docker container,
# then build an HTML report. Same behaviour as evals/run.sh, which runs opencode. Manual only: it calls paid model APIs.
# Never run it from CI.
set -euo pipefail

route=${1:-}
case "$route" in claude|pi) shift ;; *) route="" ;; esac
ref=HEAD save="" force_save=0 models="" runs=3 concurrency=2 stories="" envfile="" seed="" out=""
usage() {
  cat >&2 <<'U'
usage: evals/routes/run.sh <claude|pi> --models a,b --env-file FILE [options]
  --models LIST       comma list of OpenRouter model IDs, e.g. anthropic/claude-sonnet-5.5 (an openrouter/ prefix is removed).
                      claude: Anthropic models only (OpenRouter's Anthropic-compatible endpoint). pi: any OpenRouter model.
  --env-file FILE     file with OPENROUTER_API_KEY=value (values NOT quoted), passed to the container, never baked into the image
  --ref REF           git ref whose committed skills/job-board is installed (default HEAD; use origin/main to test what is public)
  --runs N            runs per model and story (default 3)
  --stories S1,S5     only these stories (default all)
  --concurrency N     parallel runs (default 2; Docker Desktop's 2 GB VM runs out of memory at 6)
  --seed N            shuffle seed (default random)
  --out DIR           output directory (default evals/out/<route>-<timestamp>)
  --save NAME         also copy summary.md and summary.json to evals/results/<date>-<route>-NAME.* (commit these to compare later)
  --force-save        let --save overwrite an existing evals/results/<date>-<route>-NAME.* pair
U
  exit 2
}
fail() { echo "error: $*" >&2; exit 1; }
# every flag below takes a value: print usage instead of tripping `set -u` when it is missing
val() { [ "$#" -ge 2 ] && [ -n "$2" ] || { echo "error: $1 needs a value" >&2; usage; }; }
[ -n "$route" ] || { echo "error: the first argument must be claude or pi" >&2; usage; }
while [ $# -gt 0 ]; do
  case "$1" in
    --models) val "$@"; models=$2; shift 2 ;; --env-file) val "$@"; envfile=$2; shift 2 ;; --ref) val "$@"; ref=$2; shift 2 ;;
    --runs) val "$@"; runs=$2; shift 2 ;; --stories) val "$@"; stories=$2; shift 2 ;; --concurrency) val "$@"; concurrency=$2; shift 2 ;;
    --seed) val "$@"; seed=$2; shift 2 ;; --save) val "$@"; save=$2; shift 2 ;; --out) val "$@"; out=$2; shift 2 ;;
    --force-save) force_save=1; shift ;; *) echo "error: unknown option $1" >&2; usage ;;
  esac
done
[ -n "$models" ] && [ -n "$envfile" ] || usage

here=$(cd "$(dirname "$0")" && pwd)
evals=$(cd "$here/.." && pwd)
root=$(cd "$evals/.." && pwd)
date_now=$(date +%F)
saved="$date_now-$route-$save"

# Validate everything before any directory is made or any docker call happens.
[ -f "$envfile" ] && [ -r "$envfile" ] || fail "--env-file '$envfile' is not a readable file"
# docker --env-file keeps quote characters as part of the value, so a quoted key would be sent with its quotes and rejected
if grep -Eq '^[A-Za-z_][A-Za-z0-9_]*=["'"'"']' "$envfile"; then fail "--env-file '$envfile' has a quoted value; write KEY=value with no quotes (docker keeps the quotes as part of the value)"; fi
grep -Eq '^OPENROUTER_API_KEY=.' "$envfile" || fail "--env-file '$envfile' has no OPENROUTER_API_KEY=value line (both routes read their key from it)"
commit=$(git -C "$root" rev-parse --verify --quiet "$ref^{commit}") || fail "--ref '$ref' is not a commit in this repository"
case "$runs" in ''|*[!0-9]*|0) fail "--runs must be a positive integer" ;; esac
case "$concurrency" in ''|*[!0-9]*|0) fail "--concurrency must be a positive integer" ;; esac
case "$seed" in ''|*[!0-9]*) [ -z "$seed" ] || fail "--seed must be a non-negative integer" ;; esac
if [ "$route" = claude ]; then
  IFS=, read -ra model_list <<< "$models"
  for m in "${model_list[@]}"; do
    case "${m#openrouter/}" in anthropic/?*) ;; *) fail "claude route: model '$m' is not an Anthropic model (use anthropic/<name>); OpenRouter's Anthropic-compatible endpoint serves only those" ;; esac
  done
fi
if [ -n "$save" ]; then
  [[ $save =~ ^[A-Za-z0-9._-]+$ ]] && [[ $save != .* ]] || fail "--save name '$save' must match ^[A-Za-z0-9._-]+\$ and not start with '.'"
  if [ "$force_save" -eq 0 ]; then
    for ext in md json; do
      [ ! -e "$evals/results/$saved.$ext" ] || fail "evals/results/$saved.$ext already exists; pick another --save name or pass --force-save"
    done
  fi
fi

# Installed before anything is created. The container is removed by name so even a half-finished `docker create` cannot leak
# the env-file values, which docker stores in the container config (visible to `docker inspect`) until the container is removed.
cname="jb-route-$route-$$-$(date +%s)"
cleanup() { docker rm -f "$cname" >/dev/null 2>&1 || true; }
trap cleanup EXIT

short=$(git -C "$root" rev-parse --short "$commit")
# Build the route image (agent install + skill install route) and run verify.mjs in it, model-free and without the key.
# install-check.sh archives the same commit, so the image tag below is the one it just built and verified.
"$here/install-check.sh" "$route" --ref "$commit" || fail "the $route install check failed for $short; no model was called"
tag=jb-route-$route:$short

out=${out:-$evals/out/$route-$(date +%Y%m%d-%H%M%S)}
mkdir -p "$out"; out=$(cd "$out" && pwd)
seed=${seed:-$(( RANDOM * 32768 + RANDOM ))}

printf '{"date":"%s","ref":"%s","commit":"%s","name":"%s","route":"%s"}\n' "$date_now" "$ref" "$short" "$route-${save:-$ref}" "$route" > "$out/meta.json"
docker create --name "$cname" --env-file "$envfile" \
  -e MODELS="$models" -e RUNS="$runs" -e CONCURRENCY="$concurrency" -e SEED="$seed" -e STORIES="$stories" \
  "$tag" node "/evals/run-$route.mjs" >/dev/null
rc=0
docker start -a "$cname" || rc=$?
docker cp "$cname:/out/." "$out/" || fail "could not copy results out of the container"
for f in results.jsonl order.json; do
  [ -s "$out/$f" ] || fail "the runner exited with $rc before writing $f (it died early); see its output above. Nothing was graded."
done
# meta.json also carries the route and the agent versions the runner recorded
[ ! -s "$out/versions.json" ] || node -e '
  const fs = require("fs"), [m, v] = process.argv.slice(1);
  fs.writeFileSync(m, JSON.stringify({ ...JSON.parse(fs.readFileSync(m, "utf8")), versions: JSON.parse(fs.readFileSync(v, "utf8")) }) + "\n");
' "$out/meta.json" "$out/versions.json"
node "$evals/report.mjs" "$out"
node "$evals/summary.mjs" "$out" >/dev/null
invalid=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).meta.invalidRuns)' "$out/summary.json")
if [ "$invalid" -gt 0 ]; then
  echo "WARNING: $invalid run(s) hit an API error (credit limit, bad key, provider outage) and are excluded from every rate." >&2
  [ -n "$save" ] && echo "Not saving to evals/results/: fix the cause and repeat the run." >&2
elif [ "$rc" -ne 0 ]; then
  echo "WARNING: the runner exited with $rc." >&2
  [ -n "$save" ] && echo "Not saving to evals/results/." >&2
elif [ -n "$save" ]; then
  mkdir -p "$evals/results"
  cp "$out/summary.md" "$evals/results/$saved.md"
  cp "$out/summary.json" "$evals/results/$saved.json"
  echo "saved evals/results/$saved.{md,json}"
fi
echo "open $out/report.html"
exit $(( invalid > 0 || rc != 0 ? 1 : 0 ))
