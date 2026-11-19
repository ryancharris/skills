// Offline tests for evals/routes/run.sh. A stub `docker` on PATH records every call and replays a canned result directory,
// so no image is built, no container runs and no model is called.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = new URL("./run.sh", import.meta.url).pathname;
const evals = new URL("..", import.meta.url).pathname;
const fx = (n) => readFileSync(new URL(`./fixtures/${n}.jsonl`, import.meta.url), "utf8");
const work = mkdtempSync(join(tmpdir(), "launcher-"));
const stubDir = join(work, "bin");
const log = join(work, "docker.log");
mkdirSync(stubDir);
writeFileSync(join(stubDir, "docker"), `#!/usr/bin/env bash
echo "$*" >> "$DOCKER_LOG"
case "$1" in
  build) exit \${STUB_BUILD_RC:-0} ;;
  create) echo stubcid ;;
  start) [ "$2" = -a ] && echo "runner output"; exit \${STUB_RUN_RC:-0} ;;
  wait) echo 0 ;;
  cp) case "$2" in *:/out/.) [ -n "\${STUB_OUT:-}" ] && cp -R "$STUB_OUT/." "$3" ;; esac ;;
esac
exit 0
`);
chmodSync(join(stubDir, "docker"), 0o755);
const envFile = join(work, "env");
writeFileSync(envFile, "OPENROUTER_API_KEY=sk-or-v1-fakefakefake\n");
const stamp = `${process.pid}-${Date.now()}`;
const savedFiles = [];
after(() => {
  rmSync(work, { recursive: true, force: true });
  for (const f of savedFiles) rmSync(f, { force: true });
});

const sh = (args, env = {}) => {
  writeFileSync(log, "");
  const r = spawnSync(run, args, { encoding: "utf8", env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, DOCKER_LOG: log, ...env } });
  return { ...r, docker: readFileSync(log, "utf8") };
};
const base = ["claude", "--models", "anthropic/claude-sonnet-5.5", "--env-file", envFile];
const outDir = (n) => join(work, `out-${n}`);

// a results directory the stub hands back, built from real captured streams
const makeOut = (name, events, { rc = 0 } = {}) => {
  const d = join(work, `canned-${name}`);
  mkdirSync(d);
  const rec = { id: "S1", title: "t", prompt: "p", harness: "claude", model: "anthropic/claude-sonnet-5.5", run: 1, exit: rc, seconds: 1, events, stderr: "" };
  writeFileSync(join(d, "results.jsonl"), JSON.stringify(rec) + "\n");
  writeFileSync(join(d, "order.json"), JSON.stringify({ seed: 1, order: [["anthropic/claude-sonnet-5.5", "S1", 1]] }));
  writeFileSync(join(d, "versions.json"), JSON.stringify({ claude: "9.9.9", node: "22", harness: "claude" }) + "\n");
  return d;
};

// Validation failures: exit code, message, and no docker call at all.
const bad = [
  ["no route", [], 2, /first argument must be claude or pi/],
  ["unknown route", ["opencode", "--models", "m"], 2, /first argument/],
  ["missing --models", ["claude", "--env-file", envFile], 2, /usage/],
  ["flag without a value", [...base, "--runs"], 2, /--runs needs a value/],
  ["empty flag value", [...base, "--ref", ""], 2, /--ref needs a value/],
  ["unknown option", [...base, "--bogus"], 2, /unknown option --bogus/],
  ["env-file missing", ["claude", "--models", "anthropic/x", "--env-file", join(work, "nope")], 1, /not a readable file/],
  ["bad ref", [...base, "--ref", "no-such-ref-xyz"], 1, /not a commit/],
  ["runs zero", [...base, "--runs", "0"], 1, /--runs must be a positive integer/],
  ["runs text", [...base, "--runs", "x"], 1, /--runs must be a positive integer/],
  ["concurrency zero", [...base, "--concurrency", "0"], 1, /--concurrency must be a positive integer/],
  ["seed text", [...base, "--seed", "-1"], 1, /--seed must be a non-negative integer/],
  ["save with slash", [...base, "--save", "a/b"], 1, /--save name/],
  ["save with leading dot", [...base, "--save", ".x"], 1, /--save name/],
  ["claude with a non-Anthropic model", ["claude", "--models", "anthropic/ok,openai/gpt-5", "--env-file", envFile], 1, /not an Anthropic model/],
];
for (const [name, args, code, msg] of bad) {
  test(`validation: ${name}`, () => {
    const r = sh(args);
    assert.equal(r.status, code, r.stderr);
    assert.match(r.stderr, msg);
    assert.equal(r.docker, "", "docker must not be called");
  });
}

for (const [name, content, msg] of [
  ["quoted value", 'OPENROUTER_API_KEY="abc"\n', /quoted value/],
  ["no OPENROUTER_API_KEY", "OTHER=1\n", /no OPENROUTER_API_KEY/],
  ["empty OPENROUTER_API_KEY", "OPENROUTER_API_KEY=\n", /no OPENROUTER_API_KEY/],
]) {
  test(`validation: env-file with ${name}`, () => {
    const f = join(work, `env-${name.replace(/\W/g, "")}`);
    writeFileSync(f, content);
    const r = sh(["claude", "--models", "anthropic/x", "--env-file", f]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, msg);
    assert.equal(r.docker, "");
  });
}

test("validation: pi accepts a non-Anthropic model (it gets past validation to docker)", () => {
  const r = sh(["pi", "--models", "openai/gpt-5", "--env-file", envFile, "--out", outDir("pi-model")], { STUB_BUILD_RC: "1" });
  assert.doesNotMatch(r.stderr, /not an Anthropic model/);
  assert.match(r.docker, /^build /);
});

test("validation: --save refuses an existing results pair unless --force-save", () => {
  const name = `exists-${stamp}`;
  const date = spawnSync("date", ["+%F"], { encoding: "utf8" }).stdout.trim();
  const f = join(evals, "results", `${date}-claude-${name}.md`);
  mkdirSync(join(evals, "results"), { recursive: true });
  writeFileSync(f, "x");
  savedFiles.push(f);
  const r = sh([...base, "--save", name]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already exists; pick another --save name or pass --force-save/);
  assert.equal(r.docker, "");
});

test("a failed install check aborts before any container is created", () => {
  const r = sh([...base, "--out", outDir("noinstall")], { STUB_BUILD_RC: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /install check failed/);
  assert.doesNotMatch(r.docker, /^create .*--env-file/m);
  assert.equal(existsSync(outDir("noinstall")), false, "no output directory before the install check passes");
});

test("a runner that wrote nothing is a clear error and the container is removed", () => {
  const empty = join(work, "canned-empty");
  mkdirSync(empty);
  const r = sh([...base, "--out", outDir("died")], { STUB_OUT: empty, STUB_RUN_RC: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /died early/);
  assert.match(r.docker, /^rm -f jb-route-claude-/m);
});

test("a clean run: copies out, writes meta with route and versions, passes the env-file to create only, saves, refuses overwrite", () => {
  const canned = makeOut("clean", fx("claude-ok"));
  const name = `clean-${stamp}`;
  const date = spawnSync("date", ["+%F"], { encoding: "utf8" }).stdout.trim();
  savedFiles.push(join(evals, "results", `${date}-claude-${name}.md`), join(evals, "results", `${date}-claude-${name}.json`));
  const out = outDir("clean");
  const r = sh([...base, "--out", out, "--save", name], { STUB_OUT: canned });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.docker, new RegExp(`^create --name jb-route-claude-\\S+ --env-file ${envFile} .* node /evals/run-claude.mjs$`, "m"));
  assert.match(r.docker, /^rm -f jb-route-claude-/m);
  const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
  assert.equal(meta.route, "claude");
  assert.equal(meta.name, `claude-${name}`);
  assert.equal(meta.versions.claude, "9.9.9");
  for (const f of ["results.jsonl", "order.json", "versions.json", "report.html", "summary.json", "summary.md"]) assert.ok(existsSync(join(out, f)), f);
  assert.ok(existsSync(join(evals, "results", `${date}-claude-${name}.json`)));
  assert.equal(JSON.parse(readFileSync(join(out, "summary.json"), "utf8")).meta.invalidRuns, 0);
  const again = sh([...base, "--out", outDir("clean2"), "--save", name], { STUB_OUT: canned });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists/);
  assert.equal(again.docker, "");
});

test("a contaminated run (API 402) exits 1 and is not saved", () => {
  const canned = makeOut("bad", fx("claude-402"), { rc: 1 });
  const name = `bad-${stamp}`;
  const date = spawnSync("date", ["+%F"], { encoding: "utf8" }).stdout.trim();
  const target = join(evals, "results", `${date}-claude-${name}.json`);
  savedFiles.push(target, target.replace(/json$/, "md"));
  const r = sh([...base, "--out", outDir("bad"), "--save", name], { STUB_OUT: canned, STUB_RUN_RC: "3" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /1 run\(s\) hit an API error/);
  assert.match(r.stderr, /Not saving/);
  assert.equal(existsSync(target), false);
});

test("a non-zero runner exit with valid results is not saved either", () => {
  const canned = makeOut("rc", fx("claude-ok"));
  const name = `rc-${stamp}`;
  const date = spawnSync("date", ["+%F"], { encoding: "utf8" }).stdout.trim();
  const target = join(evals, "results", `${date}-claude-${name}.json`);
  savedFiles.push(target, target.replace(/json$/, "md"));
  const r = sh([...base, "--out", outDir("rc"), "--save", name], { STUB_OUT: canned, STUB_RUN_RC: "3" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /runner exited with 3/);
  assert.equal(existsSync(target), false);
});
