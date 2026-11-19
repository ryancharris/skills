// Runs inside the claude route image (evals/routes/Dockerfile.claude). Same contract as evals/run.mjs.
// Env: MODELS (comma list; an "openrouter/" prefix is accepted and removed), RUNS, CONCURRENCY, SEED, STORIES (optional comma list),
// OPENROUTER_API_KEY.
import { spawn } from "node:child_process";
import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { redactRecord, secretValues, extraNamesFromEnv } from "./redact.mjs";
import { fatalStatus } from "./abort.mjs";
import { collectVersions } from "./versions.mjs";

// Paths default to the container layout; the offline runner tests point them at a temp directory.
const EVALS_DIR = process.env.EVALS_DIR ?? "/evals";
const OUT_DIR = process.env.OUT_DIR ?? "/out";
const HOME_DIR = process.env.SLOT_HOME ?? "/home/tester";
const all = JSON.parse(readFileSync(`${EVALS_DIR}/stories.json`, "utf8"));
const only = process.env.STORIES ? process.env.STORIES.split(",") : null;
const stories = all.filter((s) => !only || only.includes(s.id));
const models = (process.env.MODELS ?? "").split(",").filter(Boolean).map((m) => m.replace(/^openrouter\//, ""));
const runs = Number(process.env.RUNS ?? 3);
const concurrency = Number(process.env.CONCURRENCY ?? 3);
const seed = Number(process.env.SEED ?? Date.now() % 2 ** 31);
const timeoutMs = Number(process.env.RUN_TIMEOUT_MS ?? 420000);
// Taken once, before any child starts: these values are scrubbed from every record before it is written.
const secrets = secretValues(process.env, extraNamesFromEnv(process.env));
if (models.length === 0) throw new Error("MODELS is empty");

let a = seed;
const rnd = () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const jobs = [];
for (const model of models) for (const s of stories) for (let run = 1; run <= runs; run++) jobs.push({ model, s, run });
for (let i = jobs.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
}
const versions = { ...collectVersions({ claude: "claude" }), harness: "claude" };
writeFileSync(`${OUT_DIR}/versions.json`, JSON.stringify(versions) + "\n");
writeFileSync(`${OUT_DIR}/order.json`, JSON.stringify({ seed, order: jobs.map((j) => [j.model, j.s.id, j.run]) }));

let next = 0;
let done = 0;
let aborted = null;
function runOne(job, slot) {
  return new Promise((resolve) => {
    const cwd = `${HOME_DIR}/slot${slot}`;
    mkdirSync(cwd, { recursive: true });
    const t = Date.now();
    let stdout = "";
    let stderr = "";
    // Claude Code's own auth variables. OpenRouter is the default backend; ANTHROPIC_BASE_URL set in the container
    // (for example a local test double) wins. ANTHROPIC_API_KEY must be empty so it does not take priority over the token.
    const env = { ...process.env, DISABLE_AUTOUPDATER: "1", ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? "https://openrouter.ai/api", ANTHROPIC_DEFAULT_HAIKU_MODEL: job.model, ANTHROPIC_DEFAULT_SONNET_MODEL: job.model, ANTHROPIC_DEFAULT_OPUS_MODEL: job.model };
    if (process.env.OPENROUTER_API_KEY) {
      env.ANTHROPIC_AUTH_TOKEN = process.env.OPENROUTER_API_KEY;
      env.ANTHROPIC_API_KEY = "";
    }
    const args = ["-p", job.s.prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--no-session-persistence", "--model", job.model];
    // stdin is ignored so claude never waits on it
    const p = spawn("claude", args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    let timedOut = false;
    // The agent runs tools in child processes that inherit the stdout pipe, so kill the whole process group.
    const timer = setTimeout(() => {
      if (p.exitCode !== null || p.signalCode !== null) return;
      timedOut = true;
      try {
        process.kill(-p.pid, "SIGKILL");
      } catch {
        p.kill("SIGKILL");
      }
    }, timeoutMs);
    let finished = false;
    // a failed spawn emits both "error" and "close"; write one record
    const finish = (exit) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const rec = redactRecord({ ...job.s, harness: "claude", model: job.model, run: job.run, exit, seconds: Math.round((Date.now() - t) / 1000), ...(timedOut ? { timedOut: true } : {}), events: stdout, stderr }, secrets);
      appendFileSync(`${OUT_DIR}/results.jsonl`, JSON.stringify(rec) + "\n");
      console.error(`${++done}/${jobs.length} ${job.model} ${job.s.id}#${job.run} exit=${exit}`);
      // Out of credit or bad key: every later run would fail the same way, so stop instead of burning the matrix.
      const fatal = fatalStatus(stdout, "claude");
      if (fatal && !aborted) {
        aborted = `provider returned HTTP ${fatal} (credit limit or bad key)`;
        console.error(`ABORTING: ${aborted}. Results so far are in results.jsonl; runs with this error are marked invalid.`);
      }
      resolve();
    };
    p.on("close", finish);
    p.on("error", () => finish(-1));
  });
}
async function worker(slot) {
  while (next < jobs.length && !aborted) await runOne(jobs[next++], slot);
}
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
if (aborted) process.exit(3);
