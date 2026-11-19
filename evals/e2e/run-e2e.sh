#!/usr/bin/env bash
# Model-free end-to-end check of run.mjs inside a container, with a stub `opencode` (no API call, no key).
#   [RUNNER=routes/run-pi.mjs STUB=pi] evals/e2e/run-e2e.sh IMAGE [SRC_DIR]     IMAGE: any jb-evals:* image. SRC_DIR: where run.mjs and its helpers are (default evals/).
# RUNNER/STUB (default run.mjs / opencode) exercise the claude and pi runners with a stub of that name; their event shapes are not
# the stub's, so only redaction, timedOut and process-group kill are checked there, not grading.
# Env: RUN_TIMEOUT_MS (default 3000 here), STORIES (default S1,S2,S3).
# Checks: a secret from --env-file is redacted from the record, a hanging run is killed with timedOut:true,
# and tool output that merely contains "statusCode":401 does not abort the matrix. No bind mounts (docker cp only).
set -euo pipefail
image=${1:?usage: run-e2e.sh IMAGE [SRC_DIR]}
here=$(cd "$(dirname "$0")" && pwd)
runner=${RUNNER:-run.mjs}; stub=${STUB:-opencode}
src=$(cd "${2:-$here/..}" && pwd)
work=$(mktemp -d); cid=""
trap '[ -n "$cid" ] && docker rm -f "$cid" >/dev/null 2>&1; rm -rf "$work"' EXIT
secret=sk-or-v1-0123456789abcdefSECRET
printf 'OPENROUTER_API_KEY=%s\nPLAIN_VAR=hello\n' "$secret" > "$work/env"
cid=$(docker create --env-file "$work/env" -e MODELS=stub/model -e RUNS=1 -e CONCURRENCY=1 -e SEED=1 \
  -e STORIES="${STORIES:-S1,S2,S3}" -e RUN_TIMEOUT_MS="${RUN_TIMEOUT_MS:-3000}" -e PATH=/tmp/stub:/usr/local/bin:/usr/bin:/bin \
  "$image" node /evals/runner.mjs)
mkdir "$work/stub"; cp "$here/opencode-stub.mjs" "$work/stub/$stub"; chmod +x "$work/stub/$stub"
docker cp "$work/stub" "$cid:/tmp/stub"
docker cp "$here/stories.e2e.json" "$cid:/evals/stories.json"
docker cp "$src/$runner" "$cid:/evals/runner.mjs"
for f in "$src"/redact.mjs "$src"/abort.mjs "$src"/versions.mjs; do [ -f "$f" ] && docker cp "$f" "$cid:/evals/$(basename "$f")"; done
rc=0; docker start -a "$cid" || rc=$?
echo "runner exit code: $rc"
mkdir "$work/o"; docker cp "$cid:/out/." "$work/o/"
echo "-- records (model story exit timedOut seconds):"
node -e 'for (const l of require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean)) { const r = JSON.parse(l); console.log(r.id, r.exit, "timedOut=" + r.timedOut, r.seconds + "s") }' "$work/o/results.jsonl"
echo "-- occurrences of the secret in results.jsonl: $(grep -c "$secret" "$work/o/results.jsonl" || true)"
echo "-- occurrences of [REDACTED]: $(grep -o '\[REDACTED\]' "$work/o/results.jsonl" | wc -l | tr -d ' ')"
[ -f "$work/o/versions.json" ] && { echo "-- versions.json:"; cat "$work/o/versions.json"; echo; }
