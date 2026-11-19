// One-sided Fisher exact tests on two pass counts. "before" passed pA of nA runs, "after" passed pB of nB.
const lnFact = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
const lnC = (n, k) => lnFact(n) - lnFact(k) - lnFact(n - k);
// P(X = x) where X ~ Hypergeometric: "after" holds x of the K total passes among N runs
const pmf = (x, K, N, nB) => Math.exp(lnC(K, x) + lnC(N - K, nB - x) - lnC(N, nB));

// P(after passes at least as often as observed): small when "after" is better than chance would give
export function fisherImprove(pA, nA, pB, nB) {
  const K = pA + pB, N = nA + nB;
  let p = 0;
  for (let x = pB; x <= Math.min(nB, K); x++) p += pmf(x, K, N, nB);
  return Math.min(1, p);
}

// P(after passes at most as often as observed): small when "after" is worse than chance would give
export function fisherRegress(pA, nA, pB, nB) {
  const K = pA + pB, N = nA + nB;
  let p = 0;
  for (let x = Math.max(0, nB - (N - K)); x <= pB; x++) p += pmf(x, K, N, nB);
  return Math.min(1, p);
}
