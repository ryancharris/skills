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
const allRuns = readFileSync(`${dir}/results.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
for (const r of allRuns) r.g = grade(r);
// Runs that hit an API error are not evidence about the skill: report them, but keep them out of every rate.
const invalid = allRuns.filter((r) => r.g.invalid);
const runs = allRuns.filter((r) => !r.g.invalid);

const short = (m) => m.replace(/^openrouter\//, "");
const sum = (a, f) => a.reduce((n, x) => n + f(x), 0);
const sid = (s) => Number(s.slice(1));
const stories = [...new Set(allRuns.map((r) => r.id))].sort((a, b) => sid(a) - sid(b));
const titles = Object.fromEntries(stories.map((s) => [s, allRuns.find((r) => r.id === s).title]));
const models = [...new Set(allRuns.map((r) => r.model))].map(short).sort();

const cells = {};
for (const m of models) {
  cells[m] = {};
  for (const s of stories) {
    const rs = runs.filter((r) => short(r.model) === m && r.id === s);
    const bad = invalid.filter((r) => short(r.model) === m && r.id === s).length;
    if (rs.length || bad) cells[m][s] = { pass: sum(rs, (r) => +r.g.pass), n: rs.length, ...(bad ? { invalid: bad } : {}) };
  }
}
const perModel = {};
for (const m of models) {
  const rs = runs.filter((r) => short(r.model) === m);
  perModel[m] = {
    pass: sum(rs, (r) => +r.g.pass),
    n: rs.length,
    invalid: invalid.filter((r) => short(r.model) === m).length,
    skillLoaded: sum(rs, (r) => +r.g.skill),
    usedWeb: sum(rs, (r) => +(r.g.web > 0)),
    malformedToolCalls: sum(rs, (r) => +r.g.malformedToolCall),
    avgSeconds: rs.length ? Math.round(sum(rs, (r) => r.seconds) / rs.length) : 0,
    tokens: sum(rs, (r) => r.g.tokens),
    cost: Number(sum(rs, (r) => r.g.cost).toFixed(3)),
  };
}
const failures = {};
for (const r of runs) for (const w of r.g.why) {
  const k = `${r.id}: ${w.split(": ")[0]}`;
  failures[k] = (failures[k] ?? 0) + 1;
}
const invalidReasons = {};
for (const r of invalid) {
  const k = r.g.invalidReason.slice(0, 120);
  invalidReasons[k] = (invalidReasons[k] ?? 0) + 1;
}
const summary = { meta: { ...meta, seed: order.seed, runs: runs.length, invalidRuns: invalid.length }, stories: titles, cells, perModel, failures, invalidReasons };
writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2) + "\n");

const cell = (c) => (c ? `${c.pass}/${c.n}${c.invalid ? ` (+${c.invalid} err)` : ""}` : "");
const lines = [];
lines.push(`# Agent eval: ${meta.name ?? meta.ref} (${meta.date})`, "");
lines.push(`- Skill: \`${meta.ref}\` at \`${meta.commit}\``);
if (invalid.length > 0) lines.push(`- **WARNING: ${invalid.length} of ${allRuns.length} runs hit an API error and are excluded from every rate below.** Do not compare this run until it is repeated. First error: ${invalid[0].g.invalidReason.slice(0, 160)}`);
lines.push(`- ${runs.length} valid runs, ${models.length} models, stories ${stories.join(", ")}, shuffle seed ${order.seed}`);
lines.push(`- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (\`evals/grade.mjs\`); S7 and S9 match wording, so a pass there is weaker evidence.`, "");
lines.push("## Passes by model and story", "");
lines.push(`| Model | ${stories.join(" | ")} | Total |`, `|---|${stories.map(() => "---").join("|")}|---|`);
for (const m of models) lines.push(`| ${m} | ${stories.map((s) => cell(cells[m][s])).join(" | ")} | ${perModel[m].pass}/${perModel[m].n}${perModel[m].invalid ? ` (+${perModel[m].invalid} err)` : ""} |`);
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
