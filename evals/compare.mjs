// Usage: node evals/compare.mjs <before/summary.json> <after/summary.json>
// Prints per-story and per-model pass counts side by side over the models and stories both runs share.
// "p" is a one-sided Fisher exact test that "after" passes more than "before". With a few runs it is weak evidence.
import { readFileSync } from "node:fs";

const [aPath, bPath] = process.argv.slice(2);
if (!bPath) {
  console.error("usage: node evals/compare.mjs <before/summary.json> <after/summary.json>");
  process.exit(2);
}
const A = JSON.parse(readFileSync(aPath, "utf8"));
const B = JSON.parse(readFileSync(bPath, "utf8"));

const lnFact = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
const lnC = (n, k) => lnFact(n) - lnFact(k) - lnFact(n - k);
// P(X >= x) where X ~ Hypergeometric: after passes x of nB, with K total passes among nA+nB
function fisherGreater(pA, nA, pB, nB) {
  const K = pA + pB, N = nA + nB;
  let p = 0;
  for (let x = pB; x <= Math.min(nB, K); x++) p += Math.exp(lnC(K, x) + lnC(N - K, nB - x) - lnC(N, nB));
  return Math.min(1, p);
}
const models = Object.keys(A.cells).filter((m) => m in B.cells);
const stories = Object.keys(A.stories).filter((s) => s in B.stories).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
const tot = (S, m, s) => S.cells[m]?.[s] ?? { pass: 0, n: 0 };

console.log(`# Compare: ${A.meta.name ?? A.meta.ref} (${A.meta.commit}) -> ${B.meta.name ?? B.meta.ref} (${B.meta.commit})\n`);
console.log(`Shared models: ${models.join(", ")}\n`);
console.log("| Story | Before | After | Change | p |\n|---|---|---|---|---|");
for (const s of stories) {
  let pa = 0, na = 0, pb = 0, nb = 0;
  for (const m of models) {
    const a = tot(A, m, s), b = tot(B, m, s);
    pa += a.pass; na += a.n; pb += b.pass; nb += b.n;
  }
  if (!na || !nb) continue;
  const d = Math.round((100 * pb) / nb - (100 * pa) / na);
  console.log(`| ${s} ${A.stories[s]} | ${pa}/${na} | ${pb}/${nb} | ${d > 0 ? "+" : ""}${d} pts | ${fisherGreater(pa, na, pb, nb).toFixed(3)} |`);
}
console.log("\n| Model | Before | After |\n|---|---|---|");
for (const m of models) {
  let pa = 0, na = 0, pb = 0, nb = 0;
  for (const s of stories) {
    const a = tot(A, m, s), b = tot(B, m, s);
    pa += a.pass; na += a.n; pb += b.pass; nb += b.n;
  }
  console.log(`| ${m} | ${pa}/${na} | ${pb}/${nb} |`);
}
