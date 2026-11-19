// Usage: node evals/compare.mjs <before/summary.json> <after/summary.json>
// Prints per-story and per-model pass counts side by side over the models and stories both runs share.
// Each story gets two one-sided Fisher exact p values: "p improve" (after passes more than before) and "p regress" (after passes less).
// Runs are pooled across models, and repeated prompts are not independent samples, so p is exploratory, not a verdict.
import { readFileSync } from "node:fs";
import { fisherImprove, fisherRegress } from "./fisher.mjs";
import { mdText } from "./md.mjs";

const [aPath, bPath] = process.argv.slice(2);
if (!bPath) {
  console.error("usage: node evals/compare.mjs <before/summary.json> <after/summary.json>");
  process.exit(2);
}
const A = JSON.parse(readFileSync(aPath, "utf8"));
const B = JSON.parse(readFileSync(bPath, "utf8"));

const models = Object.keys(A.cells).filter((m) => m in B.cells);
const stories = Object.keys(A.stories).filter((s) => s in B.stories).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
const tot = (S, m, s) => S.cells[m]?.[s] ?? { pass: 0, n: 0 };

console.log(`# Compare: ${A.meta.name ?? A.meta.ref} (${A.meta.commit}) -> ${B.meta.name ?? B.meta.ref} (${B.meta.commit})\n`);
console.log(`Shared models: ${models.map(mdText).join(", ")}\n`);
console.log("Runs are pooled across models, and repeated prompts are not independent, so p is exploratory. A small p suggests a difference; it does not prove one.\n");
const va = A.meta.versions, vb = B.meta.versions;
if (!va || !vb) console.log(`WARNING: agent versions not recorded for ${[!va && "before", !vb && "after"].filter(Boolean).join(" and ")}; cannot tell whether the agent changed between the runs.\n`);
else if (JSON.stringify(Object.entries(va).sort()) !== JSON.stringify(Object.entries(vb).sort())) console.log(`WARNING: agent versions differ between the runs (before ${mdText(JSON.stringify(va))}, after ${mdText(JSON.stringify(vb))}); a change may come from the agent, not the skill.\n`);
console.log("| Story | Before | After | Change | p improve | p regress |\n|---|---|---|---|---|---|");
for (const s of stories) {
  let pa = 0, na = 0, pb = 0, nb = 0;
  for (const m of models) {
    const a = tot(A, m, s), b = tot(B, m, s);
    pa += a.pass; na += a.n; pb += b.pass; nb += b.n;
  }
  if (!na || !nb) continue;
  const d = Math.round((100 * pb) / nb - (100 * pa) / na);
  console.log(`| ${s} ${mdText(A.stories[s])} | ${pa}/${na} | ${pb}/${nb} | ${d > 0 ? "+" : ""}${d} pts | ${fisherImprove(pa, na, pb, nb).toFixed(3)} | ${fisherRegress(pa, na, pb, nb).toFixed(3)} |`);
}
console.log("\n| Model | Before | After |\n|---|---|---|");
for (const m of models) {
  let pa = 0, na = 0, pb = 0, nb = 0;
  for (const s of stories) {
    const a = tot(A, m, s), b = tot(B, m, s);
    pa += a.pass; na += a.n; pb += b.pass; nb += b.n;
  }
  console.log(`| ${mdText(m)} | ${pa}/${na} | ${pb}/${nb} |`);
}
