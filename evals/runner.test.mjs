// Offline end-to-end tests of the three runners with a stub agent on PATH (no Docker, no model). The runners are copied flat into a
// temp directory, as they sit in the container image.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const evals = new URL(".", import.meta.url).pathname;
const SECRET = "sk-or-v1-0123456789abcdefSECRET";

function setup(runner, agent) {
  const dir = mkdtempSync(join(tmpdir(), "runner-"));
  for (const d of ["evals", "out", "bin", "home"]) mkdirSync(join(dir, d));
  for (const f of ["redact.mjs", "abort.mjs", "versions.mjs"]) copyFileSync(join(evals, f), join(dir, "evals", f));
  copyFileSync(join(evals, runner), join(dir, "evals", "runner.mjs"));
  copyFileSync(join(evals, "e2e/stories.e2e.json"), join(dir, "evals", "stories.json"));
  copyFileSync(join(evals, "e2e/opencode-stub.mjs"), join(dir, "bin", agent));
  chmodSync(join(dir, "bin", agent), 0o755);
  return dir;
}
function run(dir, stories, extra = {}) {
  const r = spawnSync(process.execPath, [join(dir, "evals/runner.mjs")], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, EVALS_DIR: join(dir, "evals"), OUT_DIR: join(dir, "out"), SLOT_HOME: join(dir, "home"),
      MODELS: "stub/model", RUNS: "1", CONCURRENCY: "1", SEED: "1", STORIES: stories, RUN_TIMEOUT_MS: "1500", OPENROUTER_API_KEY: SECRET, ...extra },
  });
  const file = join(dir, "out/results.jsonl");
  const records = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { r, records, text: existsSync(file) ? readFileSync(file, "utf8") : "" };
}

for (const [runner, agent] of [["run.mjs", "opencode"], ["routes/run-pi.mjs", "pi"], ["routes/run-claude.mjs", "claude"]]) {
  test(`${runner}: the key printed by the agent is redacted, a hanging run is killed with timedOut, and tool-output status text does not abort`, () => {
    const dir = setup(runner, agent);
    const { r, records, text } = run(dir, "S1,S2,S3");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(records.length, 3);
    assert.ok(!text.includes(SECRET), "the key must not be in results.jsonl");
    assert.match(records.find((x) => x.id === "S1").events, /OPENROUTER_API_KEY=\[REDACTED\]/);
    const slow = records.find((x) => x.id === "S2");
    assert.equal(slow.timedOut, true);
    assert.notEqual(slow.exit, 0);
    for (const id of ["S1", "S3"]) assert.ok(!("timedOut" in records.find((x) => x.id === id)), `${id} finished by itself, so no timedOut`);
    const v = JSON.parse(readFileSync(join(dir, "out/versions.json"), "utf8"));
    assert.equal(v[agent], "stub-1.0.0");
    assert.ok(v.node);
  });
}

test("run.mjs: an error event with statusCode 401 stops the matrix with exit 3 after one run", () => {
  const dir = setup("run.mjs", "opencode");
  const { r, records } = run(dir, "S4", { RUNS: "3" });
  assert.equal(r.status, 3);
  assert.equal(records.length, 1);
});

test("run.mjs: a run that fails by itself (non-zero exit) is not flagged timedOut", () => {
  const dir = setup("run.mjs", "opencode");
  const { records } = run(dir, "S1", { PATH: "/nonexistent" });
  assert.equal(records.length, 1);
  assert.ok(!("timedOut" in records[0]));
});
