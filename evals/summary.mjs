// Usage: node evals/summary.mjs <out-dir>  -> writes <out-dir>/summary.json and <out-dir>/summary.md
// Compact and diffable (no transcripts), so it can be committed under evals/results/ and compared later.
import { readFileSync, writeFileSync } from "node:fs";
import { grade } from "./grade.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node evals/summary.mjs <out-dir>");
  process.exit(2);
}
const meta = JSON.parse(readFileSync(`${dir}/meta.json`, "utf8"));
const order = JSON.parse(readFileSync(`${dir}/order.json`, "utf8"));
const runs = readFileSync(`${dir}/results.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
for (const r of runs) r.g = grade(r);

const short = (m) => m.replace(/^openrouter\//, "");
const sum = (a, f) => a.reduce((n, x) => n + f(x), 0);
const sid = (s) => Number(s.slice(1));
const stories = [...new Set(runs.map((r) => r.id))].sort((a, b) => sid(a) - sid(b));
const titles = Object.fromEntries(stories.map((s) => [s, runs.find((r) => r.id === s).title]));
const models = [...new Set(runs.map((r) => r.model))].map(short).sort();

const cells = {};
for (const m of models) {
  cells[m] = {};
  for (const s of stories) {
    const rs = runs.filter((r) => short(r.model) === m && r.id === s);
    if (rs.length) cells[m][s] = { pass: sum(rs, (r) => +r.g.pass), n: rs.length };
  }
}
const perModel = {};
for (const m of models) {
  const rs = runs.filter((r) => short(r.model) === m);
  perModel[m] = {
    pass: sum(rs, (r) => +r.g.pass),
    n: rs.length,
    skillLoaded: sum(rs, (r) => +r.g.skill),
    usedWeb: sum(rs, (r) => +(r.g.web > 0)),
    malformedToolCalls: sum(rs, (r) => +r.g.malformedToolCall),
    avgSeconds: Math.round(sum(rs, (r) => r.seconds) / rs.length),
    tokens: sum(rs, (r) => r.g.tokens),
    cost: Number(sum(rs, (r) => r.g.cost).toFixed(3)),
  };
}
const failures = {};
for (const r of runs) for (const w of r.g.why) {
  const k = `${r.id}: ${w.split(": ")[0]}`;
  failures[k] = (failures[k] ?? 0) + 1;
}
const summary = { meta: { ...meta, seed: order.seed, runs: runs.length }, stories: titles, cells, perModel, failures };
writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2) + "\n");

const cell = (c) => (c ? `${c.pass}/${c.n}` : "");
const lines = [];
lines.push(`# Agent eval: ${meta.name ?? meta.ref} (${meta.date})`, "");
lines.push(`- Skill: \`${meta.ref}\` at \`${meta.commit}\``);
lines.push(`- ${runs.length} runs, ${models.length} models, stories ${stories.join(", ")}, shuffle seed ${order.seed}`);
lines.push(`- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (\`evals/grade.mjs\`); S7 and S9 match wording, so a pass there is weaker evidence.`, "");
lines.push("## Passes by model and story", "");
lines.push(`| Model | ${stories.join(" | ")} | Total |`, `|---|${stories.map(() => "---").join("|")}|---|`);
for (const m of models) lines.push(`| ${m} | ${stories.map((s) => cell(cells[m][s])).join(" | ")} | ${perModel[m].pass}/${perModel[m].n} |`);
lines.push("", "## Stories", "");
for (const s of stories) lines.push(`- **${s}**: ${titles[s]}`);
lines.push("", "## Per model", "", "| Model | Loaded the skill | Runs using web tools | Malformed tool calls | Avg seconds | Tokens | Cost |", "|---|---|---|---|---|---|---|");
for (const m of models) {
  const p = perModel[m];
  lines.push(`| ${m} | ${p.skillLoaded}/${p.n} | ${p.usedWeb} | ${p.malformedToolCalls} | ${p.avgSeconds} | ${Math.round(p.tokens / 1000)}k | $${p.cost.toFixed(2)} |`);
}
lines.push("", "## Failed checks", "");
const fk = Object.entries(failures).sort();
if (fk.length === 0) lines.push("None.");
else for (const [k, n] of fk) lines.push(`- ${k} (${n})`);
writeFileSync(`${dir}/summary.md`, lines.join("\n") + "\n");
console.log(`${dir}/summary.md`);
