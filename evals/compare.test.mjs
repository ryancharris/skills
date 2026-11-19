import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fisherImprove, fisherRegress } from "./fisher.mjs";

// Independent exact computation: integers only, one division at the end.
const C = (n, k) => {
  let r = 1n;
  for (let i = 1n; i <= BigInt(k); i++) r = (r * (BigInt(n) - BigInt(k) + i)) / i;
  return r;
};
function exact(pA, nA, pB, nB, side) {
  const K = pA + pB, N = nA + nB;
  let num = 0n;
  for (let x = 0; x <= Math.min(nB, K); x++) {
    if (nB - x > N - K) continue;
    if (side === "improve" ? x >= pB : x <= pB) num += C(K, x) * C(N - K, nB - x);
  }
  const den = C(N, nB);
  return { num, den, value: Number((num * 10n ** 15n) / den) / 1e15 };
}

test("known value: 1/4 before, 3/4 after is 17/70 one-sided", () => {
  const e = exact(1, 4, 3, 4, "improve");
  assert.equal(e.num * 70n, 17n * e.den);
  assert.ok(Math.abs(fisherImprove(1, 4, 3, 4) - 17 / 70) < 1e-12);
  assert.equal(fisherImprove(1, 4, 3, 4).toFixed(6), "0.242857");
});

test("regression: 3/4 before, 1/4 after is 17/70 on the regress side and about 0.986 on the improve side", () => {
  assert.ok(Math.abs(fisherRegress(3, 4, 1, 4) - 17 / 70) < 1e-12);
  assert.equal(fisherImprove(3, 4, 1, 4).toFixed(3), "0.986");
});

test("both sides match an exact BigInt computation over a grid of counts", () => {
  for (const nA of [1, 3, 5, 10, 30]) for (const nB of [1, 3, 8, 10, 33]) {
    for (let pA = 0; pA <= nA; pA++) for (let pB = 0; pB <= nB; pB++) {
      assert.ok(Math.abs(fisherImprove(pA, nA, pB, nB) - exact(pA, nA, pB, nB, "improve").value) < 1e-9, `improve ${pA}/${nA} ${pB}/${nB}`);
      assert.ok(Math.abs(fisherRegress(pA, nA, pB, nB) - exact(pA, nA, pB, nB, "regress").value) < 1e-9, `regress ${pA}/${nA} ${pB}/${nB}`);
    }
  }
});

test("identical runs: both p values are 1 or close to it, never below 0.5", () => {
  assert.ok(fisherImprove(5, 10, 5, 10) > 0.5 && fisherRegress(5, 10, 5, 10) > 0.5);
});

const summary = (pass, n, versions) => ({
  meta: { name: "x", commit: "abc", ...(versions ? { versions } : {}) },
  stories: { S1: "Weird | `title`" },
  cells: { "m|odel": { S1: { pass, n } } },
});
function runCompare(a, b) {
  const dir = mkdtempSync(join(tmpdir(), "cmp-"));
  writeFileSync(join(dir, "a.json"), JSON.stringify(a));
  writeFileSync(join(dir, "b.json"), JSON.stringify(b));
  return spawnSync(process.execPath, [new URL("./compare.mjs", import.meta.url).pathname, join(dir, "a.json"), join(dir, "b.json")], { encoding: "utf8" });
}

test("compare.mjs prints both p values, the pooling caveat, and a regression is not p=1.000 on the regress side", () => {
  const r = runCompare(summary(3, 4, { opencode: "1.19.6", node: "22" }), summary(1, 4, { opencode: "1.19.6", node: "22" }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /p improve \| p regress/);
  assert.match(r.stdout, /\| 0\.986 \| 0\.243 \|/);
  assert.match(r.stdout, /pooled across models/);
  assert.match(r.stdout, /not independent/);
  assert.ok(!r.stdout.includes("WARNING"));
});

test("compare.mjs warns when agent versions differ or are missing, and escapes table cells", () => {
  const diff = runCompare(summary(1, 4, { opencode: "1.19.6", node: "22" }), summary(3, 4, { opencode: "1.20.0", node: "22" }));
  assert.match(diff.stdout, /WARNING: agent versions differ/);
  const missing = runCompare(summary(1, 4), summary(3, 4, { opencode: "1.19.6", node: "22" }));
  assert.match(missing.stdout, /WARNING: agent versions not recorded for before/);
  assert.ok(!/[^\\]\|odel/.test(diff.stdout));
  assert.ok(diff.stdout.includes("m\\|odel") && diff.stdout.includes("Weird \\| 'title'"));
});
