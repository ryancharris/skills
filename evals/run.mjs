// Runs inside the container. Env: MODELS (comma list), RUNS, CONCURRENCY, SEED, STORIES (optional comma list).
import { spawn } from "node:child_process";
import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const all = JSON.parse(readFileSync("/evals/stories.json", "utf8"));
const only = process.env.STORIES ? process.env.STORIES.split(",") : null;
const stories = all.filter((s) => !only || only.includes(s.id));
const models = (process.env.MODELS ?? "").split(",").filter(Boolean);
const runs = Number(process.env.RUNS ?? 3);
const concurrency = Number(process.env.CONCURRENCY ?? 4);
const seed = Number(process.env.SEED ?? Date.now() % 2 ** 31);
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
writeFileSync("/out/order.json", JSON.stringify({ seed, order: jobs.map((j) => [j.model, j.s.id, j.run]) }));

let next = 0;
let done = 0;
function runOne(job, slot) {
  return new Promise((resolve) => {
    const cwd = `/home/tester/slot${slot}`;
    mkdirSync(cwd, { recursive: true });
    const t = Date.now();
    let stdout = "";
    let stderr = "";
    // stdin must be ignored: opencode run waits on an open stdin pipe
    const p = spawn("opencode", ["run", "--format", "json", "--auto", "-m", job.model, job.s.prompt], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => p.kill("SIGKILL"), 420000);
    const finish = (exit) => {
      clearTimeout(timer);
      const rec = { ...job.s, model: job.model, run: job.run, exit, seconds: Math.round((Date.now() - t) / 1000), events: stdout, stderr: stderr.slice(0, 2000) };
      appendFileSync("/out/results.jsonl", JSON.stringify(rec) + "\n");
      console.error(`${++done}/${jobs.length} ${job.model} ${job.s.id}#${job.run} exit=${exit}`);
      resolve();
    };
    p.on("close", finish);
    p.on("error", () => finish(-1));
  });
}
async function worker(slot) {
  while (next < jobs.length) await runOne(jobs[next++], slot);
}
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
